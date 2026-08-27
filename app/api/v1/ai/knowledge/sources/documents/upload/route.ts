/**
 * POST /api/v1/ai/knowledge/sources/documents/upload
 *
 * Upload em lote de arquivos .md para a fonte 'documents' do agente (achada
 * ou criada na hora — uma só por agente, como os demais tipos, via
 * `ai_knowledge_sources_unique_per_agent`). Cada arquivo vira uma linha em
 * `ai_document_items`; reenviar um arquivo com o MESMO nome substitui o
 * conteúdo (upsert por `knowledge_source_id, filename`) em vez de duplicar.
 *
 * Diferente de `sources/upload/route.ts` (política, PDF/MD único): aqui o
 * texto extraído é gravado direto em `ai_document_items.content` — é o que
 * `workers/rag-indexer.ts` consulta para montar a base. Sem Storage
 * intermediário: são arquivos de texto, o próprio banco já é a fonte da
 * verdade, e reindexar nunca precisa rebaixar um blob.
 *
 * Auth: cookie session. Role >= manager required.
 * organization_id é resolvido do JWT — NUNCA do body.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractMarkdownText } from "@/lib/ai/rag/extractors/markdown";

export const dynamic = "force-dynamic";

const MAX_FILES_PER_REQUEST = 30;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB — são arquivos de texto
const ALLOWED_MIME_TYPES = new Set(["text/markdown", "text/x-markdown", "text/plain"]);

const agentIdSchema = z.string().uuid();

interface FileResult {
  filename: string;
  status: "ok" | "error";
  error?: string;
  chars?: number;
}

function isMarkdownFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "md") return false;
  return file.type === "" || ALLOWED_MIME_TYPES.has(file.type);
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return fail("invalid_request", "Falha ao processar multipart/form-data.", 400, { requestId });
  }

  const agentIdParsed = agentIdSchema.safeParse(formData.get("agent_id"));
  if (!agentIdParsed.success) {
    return fail("validation_failed", "Campo 'agent_id' deve ser UUID válido.", 422, { requestId });
  }
  const agentId = agentIdParsed.data;

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return fail("invalid_request", "Envie ao menos um arquivo em 'files'.", 400, { requestId });
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return fail(
      "invalid_request",
      `Máximo de ${MAX_FILES_PER_REQUEST} arquivos por envio.`,
      400,
      { requestId },
    );
  }

  // --- Validate agent belongs to org (user-scoped client, RLS enforces tenant) ---
  const supabase = await createClient();
  const { data: agent, error: agentErr } = await supabase
    .from("ai_agents")
    .select("id")
    .eq("id", agentId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (agentErr) {
    console.error("[ai-documents-upload] agent lookup failed:", agentErr.message);
    return fail("internal_error", "Erro ao validar agent_id.", 500, { requestId });
  }
  if (!agent) {
    return fail("not_found", "Agent não encontrado nesta organização.", 404, { requestId });
  }

  const admin = createAdminClient();

  // --- Find-or-create the 'documents' source for this agent ---
  const { data: existingSource, error: findErr } = await admin
    .from("ai_knowledge_sources")
    .select("id")
    .eq("organization_id", activeOrg.orgId)
    .eq("agent_id", agentId)
    .eq("source_type", "documents")
    .eq("is_active", true)
    .maybeSingle();

  if (findErr) {
    console.error("[ai-documents-upload] source lookup failed:", findErr.message);
    return fail("internal_error", "Erro ao verificar fonte de documentos.", 500, { requestId });
  }

  let sourceId: string;
  if (existingSource) {
    sourceId = (existingSource as { id: string }).id;
  } else {
    const { data: created, error: createErr } = await admin
      .from("ai_knowledge_sources")
      .insert({
        organization_id: activeOrg.orgId,
        agent_id: agentId,
        source_type: "documents",
        name: "Documentos",
        status: "ready",
      })
      .select("id")
      .single();

    if (createErr || !created) {
      console.error("[ai-documents-upload] source create failed:", createErr?.message);
      return fail("internal_error", "Erro ao criar fonte de documentos.", 500, { requestId });
    }
    sourceId = (created as { id: string }).id;
  }

  // --- Validate + extract each file; collect per-file result ---
  const results: FileResult[] = [];
  const rows: { organization_id: string; knowledge_source_id: string; filename: string; content: string }[] = [];

  for (const file of files) {
    if (!isMarkdownFile(file)) {
      results.push({ filename: file.name, status: "error", error: "Só arquivos .md são aceitos." });
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      results.push({ filename: file.name, status: "error", error: "Arquivo excede o limite de 2MB." });
      continue;
    }
    if (file.size === 0) {
      results.push({ filename: file.name, status: "error", error: "Arquivo vazio." });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const content = extractMarkdownText(buffer);
    if (content.length === 0) {
      results.push({ filename: file.name, status: "error", error: "Não há texto para indexar." });
      continue;
    }

    rows.push({
      organization_id: activeOrg.orgId,
      knowledge_source_id: sourceId,
      filename: file.name,
      content,
    });
    results.push({ filename: file.name, status: "ok", chars: content.length });
  }

  if (rows.length > 0) {
    const { error: upsertErr } = await admin
      .from("ai_document_items")
      .upsert(rows, { onConflict: "knowledge_source_id,filename" });

    if (upsertErr) {
      console.error("[ai-documents-upload] upsert failed:", upsertErr.message);
      return fail("internal_error", "Erro ao gravar os documentos.", 500, { requestId });
    }

    // Reabre a fonte se estava arquivada de um upload anterior.
    await admin
      .from("ai_knowledge_sources")
      .update({ status: "ready", ingested_at: new Date().toISOString(), last_index_error: null })
      .eq("id", sourceId)
      .eq("organization_id", activeOrg.orgId);

    const { error: emitErr } = await admin.rpc("emit_event" as never, {
      p_event_type: "knowledge_source.updated",
      p_entity_kind: "ai_knowledge_source",
      p_entity_id: sourceId,
      p_payload: {
        knowledge_source_id: sourceId,
        agent_id: agentId,
        source_type: "documents",
      },
      p_organization_id: activeOrg.orgId,
    } as never);

    if (emitErr) {
      console.warn("[ai-documents-upload] emit_event failed (non-blocking):", emitErr.message);
    }
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  return ok(
    { id: sourceId, uploaded: okCount, total: results.length, results },
    { status: 201, requestId },
  );
}
