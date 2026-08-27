/**
 * DELETE /api/v1/ai/knowledge/sources/[id]/documents/[itemId]
 *
 * Remove UM arquivo da fonte 'documents', sem afetar os demais. Dispara
 * reindex — a base precisa parar de citar um arquivo que não existe mais.
 *
 * Auth: cookie session. Role >= manager required.
 * organization_id é resolvido do JWT — NUNCA do body/path.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: sourceId, itemId } = await params;

  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  // Ownership via cliente user-scoped (RLS confere o tenant nos dois lados).
  const supabase = await createClient();
  const { data: source, error: srcErr } = await supabase
    .from("ai_knowledge_sources")
    .select("id, agent_id, source_type")
    .eq("id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (srcErr) {
    console.error("[ai-documents] DELETE source lookup failed:", srcErr.message);
    return fail("internal_error", "Erro ao verificar fonte.", 500, { requestId });
  }
  if (!source) {
    return fail("not_found", "Fonte de conhecimento não encontrada.", 404, { requestId });
  }

  const sourceRow = source as { id: string; agent_id: string; source_type: string };

  const { data: item, error: itemErr } = await supabase
    .from("ai_document_items")
    .select("id")
    .eq("id", itemId)
    .eq("knowledge_source_id", sourceId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (itemErr) {
    console.error("[ai-documents] DELETE item lookup failed:", itemErr.message);
    return fail("internal_error", "Erro ao verificar documento.", 500, { requestId });
  }
  if (!item) {
    return fail("not_found", "Documento não encontrado nesta fonte.", 404, { requestId });
  }

  const admin = createAdminClient();
  const { error: delErr } = await admin
    .from("ai_document_items")
    .delete()
    .eq("id", itemId)
    .eq("organization_id", activeOrg.orgId);

  if (delErr) {
    console.error("[ai-documents] DELETE failed:", delErr.message);
    return fail("internal_error", "Erro ao remover documento.", 500, { requestId });
  }

  // Fire-and-forget: a base precisa refletir a remoção.
  const { error: emitErr } = await admin.rpc("emit_event" as never, {
    p_event_type: "knowledge_source.updated",
    p_entity_kind: "ai_knowledge_source",
    p_entity_id: sourceId,
    p_payload: {
      knowledge_source_id: sourceId,
      agent_id: sourceRow.agent_id,
      source_type: sourceRow.source_type,
      triggered_by: "document_removed",
    },
    p_organization_id: activeOrg.orgId,
  } as never);

  if (emitErr) {
    console.warn("[ai-documents] emit_event failed (non-blocking):", emitErr.message);
  }

  return ok({ id: itemId, deleted: true as const }, { requestId });
}
