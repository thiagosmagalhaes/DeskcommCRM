"use client";
/**
 * Upload em lote de .md + gestão de arquivos individuais da fonte
 * 'documents'. Upload usa fetch cru (não `apiClient`) porque o client
 * serializa body como JSON e não fala FormData — mesmo padrão de
 * `hooks/contacts/useImportContacts.ts`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { ApiError, type ApiErrorBody } from "@/lib/api/types";
import { randomId } from "@/lib/random-id";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { sourcesQueryKey } from "@/hooks/ai/useKnowledgeSources";

export interface DocumentItem {
  id: string;
  filename: string;
  created_at: string;
  updated_at: string;
}

export interface UploadDocumentsFileResult {
  filename: string;
  status: "ok" | "error";
  error?: string;
  chars?: number;
}

export interface UploadDocumentsResult {
  id: string;
  uploaded: number;
  total: number;
  results: UploadDocumentsFileResult[];
}

export const documentItemsQueryKey = (sourceId: string) =>
  ["ai", "knowledge", "sources", sourceId, "documents"] as const;

export function useDocumentItems(sourceId: string | null) {
  return useQuery({
    queryKey: documentItemsQueryKey(sourceId ?? "none"),
    queryFn: async () => {
      const res = await apiClient.get<{ data: DocumentItem[] }>(
        `/api/v1/ai/knowledge/sources/${sourceId}/documents`,
      );
      return res.data ?? [];
    },
    enabled: !!sourceId,
  });
}

async function uploadDocuments(args: {
  agentId: string;
  files: File[];
}): Promise<UploadDocumentsResult> {
  const form = new FormData();
  form.append("agent_id", args.agentId);
  for (const file of args.files) form.append("files", file);

  const res = await fetch("/api/v1/ai/knowledge/sources/documents/upload", {
    method: "POST",
    headers: { "Idempotency-Key": randomId() },
    body: form,
    credentials: "same-origin",
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const errBody = parsed as ApiErrorBody | null;
    const e = errBody?.error;
    throw new ApiError(res.status, e?.code ?? "unknown_error", e?.details, e?.request_id ?? randomId(), e?.message);
  }
  return (parsed as { data: UploadDocumentsResult }).data;
}

export function useUploadDocuments(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => uploadDocuments({ agentId, files }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: sourcesQueryKey(agentId) });
      qc.invalidateQueries({ queryKey: documentItemsQueryKey(result.id) });
    },
    onError: (err) => {
      showApiError(err);
    },
  });
}

export function useDeleteDocumentItem(agentId: string, sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiClient.delete(`/api/v1/ai/knowledge/sources/${sourceId}/documents/${itemId}`),
    onSuccess: () => {
      toast.success("Arquivo removido.");
      qc.invalidateQueries({ queryKey: documentItemsQueryKey(sourceId) });
      qc.invalidateQueries({ queryKey: sourcesQueryKey(agentId) });
    },
    onError: (err) => {
      showApiError(err);
    },
  });
}
