import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventRow } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmbeddingProviderConfigured } from "@/lib/ai/gateway";
import { embedText } from "@/lib/ai/embed";
import { acquireDebounce } from "@/lib/ai/rag/debounce";

/**
 * `handleKnowledgeSourceUpdated` reconstrói a base com o conteúdo de TODAS as
 * fontes 'ready' do agente. Duas coisas mudaram (migration 0177):
 *
 *   1. Fontes 'documents' (ai_document_items) agora entram no reindex — antes
 *      só ai_faq_items era lida, e um upload de arquivo nunca chegava ao
 *      agente (virava `last_index_status='failed'` sozinho, no primeiro
 *      reindex automático).
 *   2. A query de fontes passou a filtrar por `source_type IN (faq, policy,
 *      documents)` — fontes de outro tipo (`catalog`, `conversations`, que
 *      têm pipeline PRÓPRIO e nascem com `status='ready'` por default) não
 *      são mais lidas nem têm `last_index_status` sobrescrito por esta
 *      função.
 */

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai/gateway", () => ({ isEmbeddingProviderConfigured: vi.fn(() => true) }));
vi.mock("@/lib/ai/embed", () => ({ embedText: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3] })) }));
vi.mock("@/lib/ai/rag/debounce", () => ({ acquireDebounce: vi.fn(async () => true) }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "55555555-5555-4555-8555-555555555555";
const DOCS_SOURCE_ID = "77777777-7777-4777-8777-777777777777";
const VERSION_ID = "99999999-9999-4999-8999-999999999999";

type Op = { op: string; args: unknown[] };

/**
 * Double genérico do client admin: cada `.from(tabela)` abre uma cadeia nova
 * que acumula as chamadas encadeadas e resolve via `.then` (await direto) ou
 * `.maybeSingle()`/`.single()`. Não filtra de verdade — cada teste semeia
 * exatamente as linhas que aquela leitura deve enxergar; o que importa aqui é
 * o EFEITO (o que foi inserido/atualizado), capturado nos callbacks.
 */
function makeAdminDouble(config: {
  data: Record<string, unknown[]>;
  onInsert?: (table: string, payload: unknown) => { data?: unknown; error?: unknown } | undefined;
  onUpdate?: (table: string, patch: unknown, filters: Array<[string, unknown]>) => void;
  onUpsert?: (table: string, rowOrRows: unknown, opts: unknown) => { error?: unknown } | undefined;
  rpc?: (name: string, args: unknown) => { data?: unknown; error?: unknown };
}) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];

  function makeChain(table: string) {
    const ops: Op[] = [];
    const target: Record<string, unknown> = {};

    const resolveList = () => ({ data: config.data[table] ?? [], error: null });

    const proxy: unknown = new Proxy(target, {
      get(_t, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            if (ops.some((o) => o.op === "upsert")) {
              const upsertOp = ops.find((o) => o.op === "upsert")!;
              const res = config.onUpsert?.(table, upsertOp.args[0], upsertOp.args[1]) ?? { error: null };
              return Promise.resolve(res).then(resolve, reject);
            }
            if (ops.some((o) => o.op === "insert")) {
              const insertOp = ops.find((o) => o.op === "insert")!;
              const res = config.onInsert?.(table, insertOp.args[0]) ?? { data: insertOp.args[0], error: null };
              return Promise.resolve(res).then(resolve, reject);
            }
            if (ops.some((o) => o.op === "update")) {
              const updateOp = ops.find((o) => o.op === "update")!;
              const filters = ops.filter((o) => o.op === "eq").map((o) => o.args as [string, unknown]);
              config.onUpdate?.(table, updateOp.args[0], filters);
              return Promise.resolve({ error: null }).then(resolve, reject);
            }
            return Promise.resolve(resolveList()).then(resolve, reject);
          };
        }
        if (prop === "maybeSingle" || prop === "single") {
          return () => {
            if (ops.some((o) => o.op === "insert")) {
              const insertOp = ops.find((o) => o.op === "insert")!;
              const res = config.onInsert?.(table, insertOp.args[0]) ?? { data: insertOp.args[0], error: null };
              return Promise.resolve(res);
            }
            const rows = (config.data[table] ?? []) as unknown[];
            const row = rows[0] ?? null;
            if (prop === "single" && !row) return Promise.resolve({ data: null, error: { message: "not found" } });
            return Promise.resolve({ data: row, error: null });
          };
        }
        return (...args: unknown[]) => {
          ops.push({ op: prop, args });
          calls.push({ table, op: prop, args });
          return proxy;
        };
      },
    });
    return proxy;
  }

  return {
    from: (table: string) => makeChain(table),
    rpc: async (name: string, args: unknown) => config.rpc?.(name, args) ?? { data: null, error: null },
    calls,
  };
}

function baseEventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "event-1",
    organization_id: ORG_ID,
    event_type: "knowledge_source.updated",
    entity_kind: "ai_knowledge_source",
    entity_id: DOCS_SOURCE_ID,
    payload: { created_at: new Date().toISOString() },
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isEmbeddingProviderConfigured).mockReturnValue(true);
  vi.mocked(embedText).mockResolvedValue({ embedding: [0.1, 0.2, 0.3] } as never);
  vi.mocked(acquireDebounce).mockResolvedValue(true);
});

describe("processRagIndexer — knowledge_source.updated", () => {
  it("indexa ai_document_items de uma fonte 'documents' (o gap que o upload de arquivo tinha)", async () => {
    const chunkCalls: Array<{ content: string; metadata: unknown }> = [];
    const sourceUpdates: Array<{ id: string; patch: unknown }> = [];

    const admin = makeAdminDouble({
      data: {
        ai_agents: [{ id: AGENT_ID, organization_id: ORG_ID, active_kb_version_id: null, is_active: true, is_default: true }],
        ai_knowledge_sources: [
          { id: DOCS_SOURCE_ID, source_type: "documents", name: "Documentos" },
        ],
        ai_faq_items: [],
        ai_document_items: [
          { knowledge_source_id: DOCS_SOURCE_ID, filename: "manual.md", content: "# Manual\n\nComo trocar a senha.", position: 0 },
        ],
        ai_knowledge_versions: [{ id: VERSION_ID, agent_id: AGENT_ID, organization_id: ORG_ID }],
      },
      onInsert: (table) => {
        if (table === "ai_knowledge_versions") {
          return { data: { id: VERSION_ID, version_number: 1 }, error: null };
        }
        return undefined;
      },
      onUpsert: (table, row) => {
        // ai_chunks.upsert grava UM chunk por chamada (objeto, não array) —
        // um por iteração do loop de embedding.
        if (table === "ai_chunks") {
          const r = row as { content: string; metadata: unknown };
          chunkCalls.push({ content: r.content, metadata: r.metadata });
        }
        return { error: null };
      },
      onUpdate: (table, patch, filters) => {
        if (table === "ai_knowledge_sources") {
          const idFilter = filters.find(([col]) => col === "id");
          sourceUpdates.push({ id: idFilter?.[1] as string, patch });
        }
      },
      rpc: (name) => {
        if (name === "activate_kb_version") return { data: null, error: null };
        return { data: null, error: null };
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const { processRagIndexer } = await import("./rag-indexer");
    const result = await processRagIndexer(baseEventRow());

    expect(result.status).toBe("ok");
    // O arquivo virou pelo menos um chunk gravado em ai_chunks, com o nome do
    // arquivo citado — é exatamente o que faltava antes desta migration.
    expect(chunkCalls.length).toBeGreaterThan(0);
    expect(chunkCalls.some((c) => c.content.includes("manual.md"))).toBe(true);
    expect(chunkCalls.some((c) => c.content.includes("Como trocar a senha"))).toBe(true);

    // A fonte 'documents' foi marcada como indexada com sucesso.
    const docsUpdate = sourceUpdates.find((u) => u.id === DOCS_SOURCE_ID);
    expect(docsUpdate?.patch).toMatchObject({ last_index_status: "success" });
  });

  it("a query de fontes filtra source_type — catalog/conversations não entram na leitura", async () => {
    // catalog/conversations têm pipeline PRÓPRIO (nuvemshop sync e
    // lib/ai/rag/ingest/conversations.ts, que gravam ai_chunks direto) e
    // nascem com status='ready' por default — se esta função os lesse, uma
    // fonte de catálogo saudável seria marcada 'failed' a cada FAQ/documento
    // reindexado, por não ter item nenhum em ai_faq_items/ai_document_items.
    // O que se pode observar de fora é a CONSTRUÇÃO da query: o filtro
    // `.in("source_type", [...])` não pode incluir 'catalog'/'conversations'.
    const admin = makeAdminDouble({
      data: {
        ai_agents: [{ id: AGENT_ID, organization_id: ORG_ID, active_kb_version_id: null, is_active: true, is_default: true }],
        ai_knowledge_sources: [{ id: DOCS_SOURCE_ID, source_type: "documents", name: "Documentos" }],
        ai_faq_items: [],
        ai_document_items: [
          { knowledge_source_id: DOCS_SOURCE_ID, filename: "manual.md", content: "Conteúdo qualquer.", position: 0 },
        ],
        ai_knowledge_versions: [{ id: VERSION_ID, agent_id: AGENT_ID, organization_id: ORG_ID }],
      },
      onInsert: (table) => {
        if (table === "ai_knowledge_versions") return { data: { id: VERSION_ID, version_number: 1 }, error: null };
        return undefined;
      },
      onUpsert: () => ({ error: null }),
      onUpdate: () => {},
      rpc: () => ({ data: null, error: null }),
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const { processRagIndexer } = await import("./rag-indexer");
    await processRagIndexer(baseEventRow());

    const inCall = admin.calls.find((c) => c.table === "ai_knowledge_sources" && c.op === "in");
    expect(inCall).toBeDefined();
    const [column, values] = inCall!.args as [string, string[]];
    expect(column).toBe("source_type");
    expect(values).toEqual(expect.arrayContaining(["faq", "policy", "documents"]));
    expect(values).not.toContain("catalog");
    expect(values).not.toContain("conversations");
  });
});
