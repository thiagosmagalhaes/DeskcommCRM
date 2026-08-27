import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail } from "@/lib/api/wrappers";

/**
 * DELETE /api/v1/ai/knowledge/sources/[id]/documents/[itemId] — remove UM
 * arquivo sem afetar os demais da mesma fonte. O caso que importa: um item
 * que existe mas pertence a OUTRA fonte (ou a fonte é de outra org) não pode
 * ser removido só porque o id do item está certo — o vínculo com a fonte do
 * path é conferido antes do delete.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_ID = "66666666-6666-4666-8666-666666666666";
const ITEM_ID = "77777777-7777-4777-8777-777777777777";

function authOk() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "user-1" } as never,
    org: { orgId: ORG_ID, name: "Org", role: "manager" } as never,
  });
}

function makeUserClient(opts: { source: unknown; item: unknown }) {
  const builders: Record<string, unknown> = {
    ai_knowledge_sources: {
      select: () => builders.ai_knowledge_sources,
      eq: () => builders.ai_knowledge_sources,
      maybeSingle: async () => ({ data: opts.source, error: null }),
    },
    ai_document_items: {
      select: () => builders.ai_document_items,
      eq: () => builders.ai_document_items,
      maybeSingle: async () => ({ data: opts.item, error: null }),
    },
  };
  return { from: (table: string) => builders[table] };
}

function makeAdminClient() {
  const deletes: Array<{ table: string; filters: unknown }> = [];
  const rpcCalls: unknown[] = [];
  const chain = {
    delete: () => chain,
    eq: (col: string, val: unknown) => {
      deletes.push({ table: "ai_document_items", filters: [col, val] });
      return chain;
    },
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  return {
    from: () => chain,
    rpc: async (_name: string, args: unknown) => {
      rpcCalls.push(args);
      return { data: null, error: null };
    },
    __deletes: deletes,
    __rpcCalls: rpcCalls,
  };
}

function delReq() {
  return new NextRequest(
    `http://localhost/api/v1/ai/knowledge/sources/${SOURCE_ID}/documents/${ITEM_ID}`,
    { method: "DELETE" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/v1/ai/knowledge/sources/[id]/documents/[itemId]", () => {
  it("sem role suficiente → repassa a resposta do requireRole", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente.", 403, {}),
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(delReq(), { params: Promise.resolve({ id: SOURCE_ID, itemId: ITEM_ID }) });
    expect(res.status).toBe(403);
  });

  it("fonte não encontrada na org ativa → 404, sem chamar o admin client", async () => {
    authOk();
    vi.mocked(createClient).mockResolvedValue(makeUserClient({ source: null, item: null }) as never);
    const { DELETE } = await import("./route");
    const res = await DELETE(delReq(), { params: Promise.resolve({ id: SOURCE_ID, itemId: ITEM_ID }) });
    expect(res.status).toBe(404);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("item não pertence a esta fonte → 404, nada é apagado", async () => {
    authOk();
    vi.mocked(createClient).mockResolvedValue(
      makeUserClient({ source: { id: SOURCE_ID, agent_id: AGENT_ID, source_type: "documents" }, item: null }) as never,
    );
    const { DELETE } = await import("./route");
    const res = await DELETE(delReq(), { params: Promise.resolve({ id: SOURCE_ID, itemId: ITEM_ID }) });
    expect(res.status).toBe(404);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("remove o item e dispara reindex (knowledge_source.updated)", async () => {
    authOk();
    vi.mocked(createClient).mockResolvedValue(
      makeUserClient({
        source: { id: SOURCE_ID, agent_id: AGENT_ID, source_type: "documents" },
        item: { id: ITEM_ID },
      }) as never,
    );
    const admin = makeAdminClient();
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(delReq(), { params: Promise.resolve({ id: SOURCE_ID, itemId: ITEM_ID }) });

    expect(res.status).toBe(200);
    expect(admin.__deletes).toContainEqual({ table: "ai_document_items", filters: ["id", ITEM_ID] });
    expect(admin.__rpcCalls[0]).toMatchObject({
      p_event_type: "knowledge_source.updated",
      p_entity_id: SOURCE_ID,
      p_organization_id: ORG_ID,
    });
  });
});
