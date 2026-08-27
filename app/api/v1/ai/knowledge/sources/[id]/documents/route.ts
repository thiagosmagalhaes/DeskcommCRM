/**
 * GET /api/v1/ai/knowledge/sources/[id]/documents
 *
 * Lista os arquivos .md de uma fonte do tipo 'documents' — o que o card
 * "Documentos" mostra para permitir remover um arquivo individualmente sem
 * mexer nos demais.
 *
 * Auth: cookie session. Role >= manager required (mesmo gate de leitura/
 * escrita das demais rotas de ai_knowledge — o conteúdo pode ser sensível ao
 * negócio, e a tela em si já é atrás desse gate).
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: sourceId } = await params;

  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();

  // Confirma que a fonte é do tenant ativo antes de listar os itens.
  const { data: source, error: srcErr } = await supabase
    .from("ai_knowledge_sources")
    .select("id")
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (srcErr) {
    console.error("[ai-documents] GET source lookup failed:", srcErr.message);
    return fail("internal_error", "Erro ao verificar fonte.", 500, { requestId });
  }
  if (!source) {
    return fail("not_found", "Fonte de conhecimento não encontrada.", 404, { requestId });
  }

  const { data, error } = await supabase
    .from("ai_document_items")
    .select("id, filename, created_at, updated_at")
    .eq("knowledge_source_id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .order("filename", { ascending: true });

  if (error) {
    console.error("[ai-documents] GET list failed:", error.message);
    return fail("internal_error", "Erro ao listar documentos.", 500, { requestId });
  }

  return ok(data ?? [], { requestId });
}
