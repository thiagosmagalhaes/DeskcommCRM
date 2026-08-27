// @vitest-environment node
//
// Multipart real (File/FormData) precisa do realm do Node — jsdom (default do
// projeto) tem File/FormData próprios que corrompem o corpo ao passar pelo
// parser de multipart do NextRequest (undici). Mesmo motivo documentado em
// app/api/v1/ai/skills/import/route.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail } from "@/lib/api/wrappers";

/**
 * POST /api/v1/ai/knowledge/sources/documents/upload — upload em lote de .md.
 *
 * Cobre o que é NOVO nesta rota em relação às demais de knowledge/sources:
 * find-or-create da fonte 'documents' (índice único por agent_id+source_type
 * continua valendo — um upload NUNCA cria uma segunda fonte), e resultado
 * por arquivo em vez de tudo-ou-nada (um .txt misturado num lote de .md não
 * derruba os arquivos válidos).
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_ID = "66666666-6666-4666-8666-666666666666";

function authOk() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "user-1" } as never,
    org: { orgId: ORG_ID, name: "Org", role: "manager" } as never,
  });
}

/** Cliente user-scoped: só usado para confirmar que o agent pertence à org. */
function makeUserClient() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: { id: AGENT_ID }, error: null }),
  };
  return { from: () => builder };
}

interface AdminConfig {
  existingSource?: { id: string } | null;
  onSourceInsert?: () => { data: { id: string } | null; error: unknown };
  onUpsert?: (rows: unknown[]) => void;
  onSourceUpdate?: (patch: unknown) => void;
  onEmit?: (payload: unknown) => void;
}

function makeAdminClient(cfg: AdminConfig) {
  const upsertCalls: unknown[][] = [];
  const sourceInserts: unknown[] = [];

  function sourcesChain() {
    const ops: { op: string; args: unknown[] }[] = [];
    const chain = {
      select: (...a: unknown[]) => { ops.push({ op: "select", args: a }); return chain; },
      eq: (...a: unknown[]) => { ops.push({ op: "eq", args: a }); return chain; },
      insert: (...a: unknown[]) => { ops.push({ op: "insert", args: a }); sourceInserts.push(a[0]); return chain; },
      update: (...a: unknown[]) => { ops.push({ op: "update", args: a }); cfg.onSourceUpdate?.(a[0]); return chain; },
      maybeSingle: async () => {
        if (ops.some((o) => o.op === "insert")) {
          const res = cfg.onSourceInsert?.() ?? { data: { id: SOURCE_ID }, error: null };
          return res;
        }
        return { data: cfg.existingSource ?? null, error: null };
      },
      single: async () => {
        const res = cfg.onSourceInsert?.() ?? { data: { id: SOURCE_ID }, error: null };
        return res;
      },
      then: (resolve: (v: unknown) => void) => resolve({ error: null }),
    };
    return chain;
  }

  function documentItemsChain() {
    const chain = {
      upsert: (rows: unknown[]) => {
        upsertCalls.push(rows);
        cfg.onUpsert?.(rows);
        return Promise.resolve({ error: null });
      },
    };
    return chain;
  }

  return {
    from: (table: string) => {
      if (table === "ai_knowledge_sources") return sourcesChain();
      if (table === "ai_document_items") return documentItemsChain();
      throw new Error(`tabela inesperada no teste: ${table}`);
    },
    rpc: async (_name: string, args: unknown) => {
      cfg.onEmit?.(args);
      return { data: null, error: null };
    },
    __upsertCalls: upsertCalls,
    __sourceInserts: sourceInserts,
  };
}

function makeUploadRequest(agentId: string, files: File[]) {
  const form = new FormData();
  form.append("agent_id", agentId);
  for (const f of files) form.append("files", f);
  return new NextRequest("http://localhost/api/v1/ai/knowledge/sources/documents/upload", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue(makeUserClient() as never);
});

describe("POST /api/v1/ai/knowledge/sources/documents/upload", () => {
  it("sem role suficiente → repassa a resposta do requireRole, sem gravar nada", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente.", 403, {}),
    });
    const admin = makeAdminClient({ existingSource: null });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const { POST } = await import("./route");
    const res = await POST(makeUploadRequest(AGENT_ID, [new File(["# a"], "a.md", { type: "text/markdown" })]));

    expect(res.status).toBe(403);
    expect(admin.__upsertCalls).toEqual([]);
  });

  it("lote misto: .md válido entra, .txt é rejeitado — sem derrubar o lote inteiro", async () => {
    authOk();
    const admin = makeAdminClient({ existingSource: null });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const md = new File(["# Manual\n\nConteúdo."], "manual.md", { type: "text/markdown" });
    const txt = new File(["não é markdown"], "planilha.txt", { type: "text/plain" });

    const { POST } = await import("./route");
    const res = await POST(makeUploadRequest(AGENT_ID, [md, txt]));

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { uploaded: number; total: number; results: Array<{ filename: string; status: string }> };
    };
    expect(body.data.uploaded).toBe(1);
    expect(body.data.total).toBe(2);
    expect(body.data.results.find((r) => r.filename === "manual.md")?.status).toBe("ok");
    expect(body.data.results.find((r) => r.filename === "planilha.txt")?.status).toBe("error");

    // Só o arquivo válido chegou a ai_document_items.
    expect(admin.__upsertCalls).toHaveLength(1);
    const rows = admin.__upsertCalls[0] as Array<{ filename: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filename).toBe("manual.md");
  });

  it("reaproveita a fonte 'documents' já existente — não cria uma segunda", async () => {
    authOk();
    const admin = makeAdminClient({ existingSource: { id: SOURCE_ID } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const { POST } = await import("./route");
    const res = await POST(
      makeUploadRequest(AGENT_ID, [new File(["texto"], "a.md", { type: "text/markdown" })]),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(SOURCE_ID);
    expect(admin.__sourceInserts).toEqual([]);
  });

  it("cria a fonte 'documents' quando não existe nenhuma ainda", async () => {
    authOk();
    const admin = makeAdminClient({ existingSource: null });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const { POST } = await import("./route");
    await POST(makeUploadRequest(AGENT_ID, [new File(["texto"], "a.md", { type: "text/markdown" })]));

    expect(admin.__sourceInserts).toHaveLength(1);
    expect(admin.__sourceInserts[0]).toMatchObject({
      organization_id: ORG_ID,
      agent_id: AGENT_ID,
      source_type: "documents",
    });
  });

  it("reenviar o mesmo nome substitui — upsert por knowledge_source_id+filename, nunca insert puro", async () => {
    authOk();
    const admin = makeAdminClient({ existingSource: { id: SOURCE_ID } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const { POST } = await import("./route");
    await POST(
      makeUploadRequest(AGENT_ID, [new File(["v2"], "manual.md", { type: "text/markdown" })]),
    );

    const rows = admin.__upsertCalls[0] as Array<{ knowledge_source_id: string; filename: string; content: string }>;
    expect(rows[0]).toMatchObject({ knowledge_source_id: SOURCE_ID, filename: "manual.md", content: "v2" });
  });
});
