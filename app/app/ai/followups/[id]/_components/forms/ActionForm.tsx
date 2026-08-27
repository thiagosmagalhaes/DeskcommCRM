"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { actionConfigSchema } from "@/lib/followup/graph-schema";
import { MODOS_DA_ACAO, opcoes, type ModoDaAcao } from "@/lib/followup/vocabulario";
import { useMessageTemplates } from "@/hooks/inbox/useMessageTemplates";
import { useTemplates } from "@/hooks/channels/useTemplates";

import type { ConfigOf } from "./shared";

/**
 * O seletor de modelo, no lugar dos dois `<Input>` que pediam um UUID colado à
 * mão. Trata os três estados em vez de fingir que a lista sempre chega:
 * carregando, vazia e erro — porque um seletor vazio sem explicação é o mesmo
 * beco sem saída que o campo de UUID era, só que mais bonito.
 */
function SeletorDeModelo({
  id,
  valor,
  onChange,
  permiteVazio,
}: {
  id: string;
  valor: string;
  onChange: (templateId: string) => void;
  permiteVazio: boolean;
}) {
  const { data: modelos, isLoading, isError } = useMessageTemplates();

  if (isLoading) return <p className="text-xs text-text-muted">Carregando seus modelos…</p>;
  if (isError) {
    return <p className="text-xs text-error-fg">Não consegui carregar seus modelos de mensagem. Recarregue a página.</p>;
  }
  if (!modelos?.length) {
    return (
      <p className="text-xs text-text-muted">
        Você ainda não tem modelos de mensagem. Crie um em Ajustes → Modelos e ele aparece aqui.
      </p>
    );
  }

  const SEM_MODELO = "__nenhum__";
  return (
    <Select
      value={valor === "" ? SEM_MODELO : valor}
      onValueChange={(v) => onChange(v === SEM_MODELO ? "" : v)}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder="Escolha um modelo" />
      </SelectTrigger>
      <SelectContent>
        {permiteVazio && <SelectItem value={SEM_MODELO}>Nenhum</SelectItem>}
        {modelos.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Endereços de slot que o montador de envio sabe preencher (`build-components.ts`
 *  `parameterFor`) — `currency`/`date_time` são objetos estruturados que ele ainda
 *  não monta, então um modelo com esse tipo de slot fica de fora da lista em vez de
 *  oferecer uma escolha que falha no envio. */
const SLOT_KINDS_SUPORTADOS = new Set(["text", "url_suffix", "image", "video", "document", "coupon_code"]);

/**
 * O seletor de modelo APROVADO da plataforma (WhatsApp) — o único que alcança um
 * lead com a janela de 24h fechada, porque é para isso que a aprovação existe.
 *
 * Reusa a MESMA lista que a tela Conexões → Templates (`useTemplates`), filtrada às
 * `APPROVED`: listar uma em revisão ou reprovada ofereceria uma escolha que falha no
 * clique (mesmo raciocínio do seletor da janela fechada, `JanelaFechadaAviso`).
 *
 * O TEXTO de cada parâmetro é fixado aqui (uma vez, na configuração do passo) —
 * mas pode conter `{{nome}}`/`{{primeiro_nome}}`, que o runtime resolve contra o
 * lead de verdade no disparo (`interpolateTemplate`, o MESMO vocabulário do
 * composer para modelos internos). Sem isso, ou com um valor vazio, o parâmetro é
 * recusado pela plataforma na hora do envio.
 */
function SeletorDeModeloAprovado({
  templateName,
  templateLanguage,
  templateValues,
  onChange,
}: {
  templateName: string;
  templateLanguage: string;
  templateValues: Record<string, string>;
  onChange: (next: { name: string; language: string; values: Record<string, string> }) => void;
}) {
  const { data, isLoading, isError } = useTemplates();

  const aprovados = (data?.data.templates ?? []).filter(
    (t) => t.status === "APPROVED" && t.slots.every((s) => SLOT_KINDS_SUPORTADOS.has(s.expects)),
  );

  if (isLoading) return <p className="text-xs text-text-muted">Carregando modelos aprovados…</p>;
  if (isError) {
    return (
      <p className="text-xs text-error-fg">
        Não consegui carregar os modelos aprovados. Recarregue a página.
      </p>
    );
  }
  if (!aprovados.length) {
    return (
      <p className="text-xs text-text-muted">
        Nenhum modelo aprovado ainda. Crie um em <strong>Conexões → Templates</strong> — ele
        aparece aqui assim que a plataforma aprovar.
      </p>
    );
  }

  const chaveAtual = templateName && templateLanguage ? `${templateName}|${templateLanguage}` : "";
  const atual = aprovados.find((t) => `${t.name}|${t.language}` === chaveAtual) ?? null;

  return (
    <div className="space-y-3">
      <Select
        value={chaveAtual}
        onValueChange={(v) => {
          const [name, language] = v.split("|");
          onChange({ name: name ?? "", language: language ?? "", values: {} });
        }}
      >
        <SelectTrigger id="action-approved-template">
          <SelectValue placeholder="Escolha um modelo aprovado…" />
        </SelectTrigger>
        <SelectContent>
          {aprovados.map((t) => (
            <SelectItem key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
              {t.name} ({t.language})
              {t.slots.length > 0 ? ` · ${t.slots.length} parâmetro(s)` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {atual && atual.slots.length > 0 && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <p className="text-xs text-text-muted">
            Valor para cada parâmetro — vai em todo envio deste passo. Use{" "}
            {"{{primeiro_nome}}"} e {"{{nome}}"} para personalizar com o dado do
            contato de cada lead.
          </p>
          {atual.slots.map((slot) => (
            <div key={slot.formKey} className="space-y-1">
              <Label htmlFor={`action-slot-${slot.formKey}`} className="text-xs">
                {slot.onde}
              </Label>
              <Input
                id={`action-slot-${slot.formKey}`}
                value={templateValues[slot.formKey] ?? ""}
                placeholder="Ex.: {{primeiro_nome}}"
                maxLength={1024}
                onChange={(e) =>
                  onChange({
                    name: templateName,
                    language: templateLanguage,
                    values: { ...templateValues, [slot.formKey]: e.target.value },
                  })
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActionForm({
  config,
  onChange,
}: {
  config: ConfigOf<"action">;
  onChange: (c: ConfigOf<"action">) => void;
}) {
  const [mode, setMode] = useState(config.mode);
  const [promptHint, setPromptHint] = useState(config.mode === "ai_message" ? config.prompt_hint : "");
  const [fallbackTemplateId, setFallbackTemplateId] = useState(
    config.mode === "ai_message" ? (config.fallback_template_id ?? "") : "",
  );
  const [templateId, setTemplateId] = useState(config.mode === "template" ? config.template_id : "");
  const [approvedName, setApprovedName] = useState(
    config.mode === "approved_template" ? config.template_name : "",
  );
  const [approvedLanguage, setApprovedLanguage] = useState(
    config.mode === "approved_template" ? config.template_language : "",
  );
  const [approvedValues, setApprovedValues] = useState<Record<string, string>>(
    config.mode === "approved_template" ? config.template_values : {},
  );
  const [error, setError] = useState<string | null>(null);

  const commit = (next: {
    mode: ModoDaAcao;
    promptHint: string;
    fallbackTemplateId: string;
    templateId: string;
    approvedName: string;
    approvedLanguage: string;
    approvedValues: Record<string, string>;
  }) => {
    const candidate =
      next.mode === "ai_message"
        ? {
            mode: "ai_message" as const,
            prompt_hint: next.promptHint,
            ...(next.fallbackTemplateId.trim() ? { fallback_template_id: next.fallbackTemplateId } : {}),
          }
        : next.mode === "approved_template"
          ? {
              mode: "approved_template" as const,
              template_name: next.approvedName,
              template_language: next.approvedLanguage,
              template_values: next.approvedValues,
            }
          : { mode: "template" as const, template_id: next.templateId };
    const parsed = actionConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Configuração inválida.");
      return;
    }
    setError(null);
    onChange(parsed.data);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="action-mode">Como escrever a mensagem</Label>
        <Select
          value={mode}
          onValueChange={(v) => {
            const next = v as ModoDaAcao;
            setMode(next);
            commit({
              mode: next,
              promptHint,
              fallbackTemplateId,
              templateId,
              approvedName,
              approvedLanguage,
              approvedValues,
            });
          }}
        >
          <SelectTrigger id="action-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opcoes(MODOS_DA_ACAO).map(({ valor, rotulo }) => (
              <SelectItem key={valor} value={valor}>
                {rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === "ai_message" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="action-prompt-hint">Instrução para a IA</Label>
            <Textarea
              id="action-prompt-hint"
              maxLength={1000}
              value={promptHint}
              onChange={(e) => {
                setPromptHint(e.target.value);
                commit({
                  mode,
                  promptHint: e.target.value,
                  fallbackTemplateId,
                  templateId,
                  approvedName,
                  approvedLanguage,
                  approvedValues,
                });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="action-fallback">Se a IA não conseguir escrever, mandar este modelo</Label>
            <SeletorDeModelo
              id="action-fallback"
              valor={fallbackTemplateId}
              permiteVazio
              onChange={(v) => {
                setFallbackTemplateId(v);
                commit({
                  mode,
                  promptHint,
                  fallbackTemplateId: v,
                  templateId,
                  approvedName,
                  approvedLanguage,
                  approvedValues,
                });
              }}
            />
          </div>
        </>
      ) : mode === "approved_template" ? (
        <div className="space-y-2">
          <Label htmlFor="action-approved-template">Modelo aprovado</Label>
          <SeletorDeModeloAprovado
            templateName={approvedName}
            templateLanguage={approvedLanguage}
            templateValues={approvedValues}
            onChange={({ name, language, values }) => {
              setApprovedName(name);
              setApprovedLanguage(language);
              setApprovedValues(values);
              commit({
                mode,
                promptHint,
                fallbackTemplateId,
                templateId,
                approvedName: name,
                approvedLanguage: language,
                approvedValues: values,
              });
            }}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="action-template-id">Modelo de mensagem</Label>
          <SeletorDeModelo
            id="action-template-id"
            valor={templateId}
            permiteVazio={false}
            onChange={(v) => {
              setTemplateId(v);
              commit({
                mode,
                promptHint,
                fallbackTemplateId,
                templateId: v,
                approvedName,
                approvedLanguage,
                approvedValues,
              });
            }}
          />
        </div>
      )}
      {error && <p className="text-xs text-error-fg">{error}</p>}
    </div>
  );
}
