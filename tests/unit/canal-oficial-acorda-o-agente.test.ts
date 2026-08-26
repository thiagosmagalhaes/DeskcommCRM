import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InboundMessageEvent } from "@/lib/channels/meta/webhook";

/**
 * O canal oficial (`meta_cloud`) grava a mensagem — mas isso é só metade da
 * ingestão. `lib/channels/pos-entrada.ts` documenta o defeito medido em
 * produção: `ai_agent.dispatch_requested` saía 806 vezes pelo canal por QR e
 * ZERO pelo oficial, porque o efeito morava dentro de `lib/waha/ingest.ts`.
 *
 * A correção extraiu o efeito para um passo compartilhado — mas conectou-o só
 * no canal por QR e no Zernio. `lib/channels/meta/ingest.ts` nunca chamava
 * `aplicarEfeitosPosEntrada`: o agente publicado nunca acordava para uma
 * mensagem chegada pelo WhatsApp Business oficial, sem erro em lugar nenhum.
 *
 * Este arquivo prova o CAMINHO DE SUCESSO — o `pos-entrada-efeitos-do-canal`
 * já prova, por leitura de fonte, que os três canais CHAMAM o passo; aqui se
 * prova que a ingestão real de fato o invoca, com os campos certos.
 */

const aplicarEfeitosPosEntrada = vi.fn(async () => {});
vi.mock("@/lib/channels/pos-entrada", () => ({
  aplicarEfeitosPosEntrada: (...a: unknown[]) => aplicarEfeitosPosEntrada(...(a as [])),
}));

const SESSAO = { id: "sessao-1", organization_id: "org-1" };

/** Client de mentira: resolve cada rota de tabela/rpc pro desfecho de SUCESSO. */
function adminDeSucesso(): SupabaseClient {
  const alvo = (dados: unknown): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      in: () => chain,
      limit: () => chain,
      insert: () => chain,
      maybeSingle: async () => ({ data: dados, error: null }),
    };
    return chain;
  };
  const from = (tabela: string) => {
    if (tabela === "channel_sessions") return alvo(SESSAO);
    if (tabela === "contacts") return alvo(null); // nenhum contato existente ainda
    if (tabela === "messages") return alvo({ id: "msg-1" });
    return alvo(null);
  };
  const rpc = async (nome: string) => {
    if (nome === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
    if (nome === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
    return { data: null, error: null }; // fn_mark_conversation_message
  };
  return { from, rpc } as unknown as SupabaseClient;
}

const EVENTO: InboundMessageEvent = {
  kind: "inbound_message",
  wabaId: "waba-1",
  phoneNumberId: "111",
  externalId: "wamid.ACORDA1",
  from: "5531998966398",
  profileName: "Cliente Oficial",
  sentAt: new Date("2026-08-26T20:58:11.000Z"),
  type: "text",
  text: "oi, preciso de ajuda",
  media: null,
};

beforeEach(() => {
  aplicarEfeitosPosEntrada.mockClear();
});

describe("canal oficial (meta_cloud) acorda o agente", () => {
  it("ingestão bem-sucedida chama o MESMO passo dos outros canais", async () => {
    const { ingestMetaInbound } = await import("@/lib/channels/meta/ingest");
    const r = await ingestMetaInbound(adminDeSucesso(), EVENTO, {
      organizationId: "org-1",
      requestId: "req-1",
    });

    expect(r.status).toBe("ingested");
    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledTimes(1);
    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        contactId: "contato-1",
        conversationId: "conversa-1",
        messageId: "msg-1",
        channelSessionId: "sessao-1",
        texto: "oi, preciso de ajuda",
        nomeDoContato: "Cliente Oficial",
        requestId: "req-1",
        origem: "meta_webhook",
      }),
    );
  });

  it("mensagem sem texto (mídia) não perde o despacho — só o texto vai nulo", async () => {
    const { ingestMetaInbound } = await import("@/lib/channels/meta/ingest");
    await ingestMetaInbound(
      adminDeSucesso(),
      { ...EVENTO, type: "image", text: null, media: { id: "m1", url: "https://x", mime: "image/jpeg", voice: false } },
      { organizationId: "org-1" },
    );

    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ texto: null }),
    );
  });

  it("sessão não encontrada não desperta o agente — nada foi gravado", async () => {
    const semSessao = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }), rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
    const { ingestMetaInbound } = await import("@/lib/channels/meta/ingest");
    const r = await ingestMetaInbound(semSessao, EVENTO, { organizationId: "org-1" });

    expect(r).toEqual({ status: "no_session" });
    expect(aplicarEfeitosPosEntrada).not.toHaveBeenCalled();
  });
});
