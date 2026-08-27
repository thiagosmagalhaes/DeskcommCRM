import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/api/wrappers";

/**
 * GET /api/v1/ai/knowledge/sources/[id]/documents — lista os arquivos de uma
 * fonte 'documents'. Isolamento: uma fonte de OUTRA org não pode ser lida
 * mesmo sabendo o id (a lista de itens depende da fonte pertencer à org ativa
 * — sem essa checagem, um id de fonte alheio devolveria os arquivos dela).
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "66666666-6666-4666-8666-666666666666";

function authOk() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "user-1" } as never,
    org: { orgId: ORG_ID, name: "Org", role: "manager" } as never,
  });
}

function makeClient(opts: { source: unknown; items: unknown[] }) {
  const builders: Record<string, unknown> = {
    ai_knowledge_sources: {
      select: () => builders.ai_knowledge_sources,
      eq: () => builders.ai_knowledge_sources,
      maybeSingle: async () => ({ data: opts.source, error: null }),
    },
    ai_document_items: {
      select: () => builders.ai_document_items,
      eq: () => builders.ai_document_items,
      order: async () => ({ data: opts.items, error: null }),
    },
  };
  return { from: (table: string) => builders[table] };
}

function getReq() {
  return new NextRequest(`http://localhost/api/v1/ai/knowledge/sources/${SOURCE_ID}/documents`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/ai/knowledge/sources/[id]/documents", () => {
  it("sem role suficiente → repassa a resposta do requireRole", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente.", 403, {}),
    });
    const { GET } = await import("./route");
    const res = await GET(getReq(), { params: Promise.resolve({ id: SOURCE_ID }) });
    expect(res.status).toBe(403);
  });

  it("fonte de outra organização → 404, não lista nada", async () => {
    authOk();
    vi.mocked(createClient).mockResolvedValue(makeClient({ source: null, items: [] }) as never);
    const { GET } = await import("./route");
    const res = await GET(getReq(), { params: Promise.resolve({ id: SOURCE_ID }) });
    expect(res.status).toBe(404);
  });

  it("lista os arquivos da fonte", async () => {
    authOk();
    const items = [
      { id: "item-1", filename: "manual.md", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" },
    ];
    vi.mocked(createClient).mockResolvedValue(makeClient({ source: { id: SOURCE_ID }, items }) as never);
    const { GET } = await import("./route");
    const res = await GET(getReq(), { params: Promise.resolve({ id: SOURCE_ID }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ filename: string }> };
    expect(body.data).toEqual(items);
  });
});
