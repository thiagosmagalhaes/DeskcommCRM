"use client";

import { useRef, useState } from "react";
import { FileText, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useDeleteDocumentItem,
  useDocumentItems,
  useUploadDocuments,
} from "@/hooks/ai/useKnowledgeDocuments";

interface Props {
  agentId: string;
  /** null quando a fonte 'documents' ainda não existe (nenhum upload feito). */
  sourceId: string | null;
  aberto: boolean;
  onFechar: () => void;
  /** Chamado depois de upload/remoção, para o card recarregar (contagem, status). */
  onMudou: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Upload em lote de .md + gestão de arquivos já enviados, na MESMA fonte
 * 'documents' do agente. Um diálogo só para as duas ações (em vez de um para
 * cadastrar e outro para gerenciar) porque a lista de arquivos já enviados é
 * o contexto que ajuda a decidir se vale subir mais um ou substituir um
 * existente (reenviar o mesmo nome substitui o conteúdo).
 */
export function DocumentsDialog({ agentId, sourceId, aberto, onFechar, onMudou }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendentes, setPendentes] = useState<File[]>([]);

  const itens = useDocumentItems(aberto ? sourceId : null);
  const upload = useUploadDocuments(agentId);
  const remover = useDeleteDocumentItem(agentId, sourceId ?? "");

  function adicionarArquivos(lista: FileList | null) {
    if (!lista) return;
    const novos = Array.from(lista).filter(
      (f) => !pendentes.some((p) => p.name === f.name && p.size === f.size),
    );
    setPendentes((prev) => [...prev, ...novos]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removerPendente(nome: string) {
    setPendentes((prev) => prev.filter((f) => f.name !== nome));
  }

  async function enviar() {
    if (pendentes.length === 0) return;
    try {
      const resultado = await upload.mutateAsync(pendentes);
      const erros = resultado.results.filter((r) => r.status === "error");
      if (resultado.uploaded > 0) {
        toast.success(
          `${resultado.uploaded} arquivo(s) enviado(s)${erros.length > 0 ? `, ${erros.length} com problema` : ""}.`,
        );
      }
      if (erros.length > 0 && resultado.uploaded === 0) {
        toast.error(erros[0]?.error ?? "Não consegui processar os arquivos.");
      } else if (erros.length > 0) {
        erros.forEach((e) => toast.warning(`${e.filename}: ${e.error}`));
      }
      setPendentes([]);
      onMudou();
    } catch {
      // Erro de rede/servidor já vira toast via showApiError no hook.
    }
  }

  function fechar() {
    setPendentes([]);
    onFechar();
  }

  const lista = itens.data ?? [];

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Documentos</DialogTitle>
          <DialogDescription>
            Envie um ou mais arquivos .md — manuais, roteiros, procedimentos. O agente passa a
            consultar tudo antes de responder. Enviar de novo um arquivo com o mesmo nome
            substitui o conteúdo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="documentos-arquivos">Arquivos .md</Label>
            <Input
              id="documentos-arquivos"
              ref={inputRef}
              type="file"
              accept=".md,text/markdown"
              multiple
              onChange={(e) => adicionarArquivos(e.target.files)}
            />
          </div>

          {pendentes.length > 0 && (
            <ul className="space-y-1 rounded-md border border-border p-2 text-sm">
              {pendentes.map((f) => (
                <li key={f.name} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 truncate">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-text-muted">
                      {(f.size / 1024).toFixed(1)} KB
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removerPendente(f.name)}
                    aria-label={`Remover ${f.name} da lista`}
                    className="shrink-0 text-text-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pendentes.length > 0 && (
            <Button
              type="button"
              size="sm"
              onClick={enviar}
              disabled={upload.isPending}
            >
              {upload.isPending ? "Enviando…" : `Enviar ${pendentes.length} arquivo(s)`}
            </Button>
          )}

          <div className="space-y-2">
            <Label>Já enviados</Label>
            {itens.isLoading && sourceId ? (
              <p className="text-sm text-text-muted">Carregando…</p>
            ) : lista.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhum arquivo enviado ainda.</p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-sm">
                {lista.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 truncate">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
                      <span className="truncate">{doc.filename}</span>
                      <span className="shrink-0 text-xs text-text-muted">
                        {formatDate(doc.updated_at)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => remover.mutate(doc.id)}
                      disabled={remover.isPending}
                      aria-label={`Remover ${doc.filename}`}
                      className="shrink-0 text-text-muted hover:text-error-fg"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
