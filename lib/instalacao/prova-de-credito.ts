/**
 * A chave funciona — e tem saldo?
 *
 * O produto já sabia responder a primeira metade e chamava isso de "Validada".
 * O validador bate em `GET /v1/models` de cada provedor: um endpoint de
 * LISTAGEM, que não consome crédito e responde 200 com a conta zerada. Ou seja,
 * o selo verde prova que a chave existe e é aceita — nunca que ela vai
 * funcionar. Quem instalou, viu "Validada" e recebeu erro na primeira conversa
 * não tinha como saber onde olhar.
 *
 * A única coisa que prova saldo é a coisa que o provedor cobra: uma geração.
 * Por isso a prova aqui é uma chamada real, mínima (um token), e por isso ela
 * nunca sai de graça — é explicitamente pedida, não roda num GET que a tela
 * chama sozinha.
 *
 * ⚠️ Não usa `runModelCall` de propósito: aquele caminho grava em `llm_calls` e
 * é barrado pelo orçamento mensal. Um diagnóstico não pode poluir a tabela que
 * ele mesmo lê, nem ser recusado justamente quando o operador precisa descobrir
 * por que nada funciona.
 */
import { normalizarErro } from "@/lib/agent-engine/edge/llm/run-model-call";
import {
  cabecalhosDeAtribuicaoOpenRouter,
  OPENROUTER_ENDPOINT,
} from "@/lib/agent-engine/edge/llm/providers";

export type ResultadoDaProva =
  | { ok: true }
  | {
      ok: false;
      /** Mesmos baldes da tela de Execuções — uma régua só para o mesmo erro. */
      codigo: string;
      mensagem: string;
      httpStatus: number | null;
    };

interface Requisicao {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A menor geração possível em cada provedor: o parâmetro de teto de tokens de
 * cada um cravado em 1, porque o objetivo é atravessar a cobrança, não obter
 * texto.
 */
export function montarRequisicaoDeProva(
  provider: string,
  apiKey: string,
  modelo: string,
  baseUrl?: string,
): Requisicao | null {
  const msg = [{ role: "user", content: "oi" }];
  switch (provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: { model: modelo, max_tokens: 1, messages: msg },
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        // `max_completion_tokens`, não `max_tokens`: os modelos de raciocínio
        // (o1/o3, família gpt-5 e além) recusam `max_tokens` com
        // `unsupported_parameter` — a chave e o saldo estavam certos, só o
        // corpo da prova é que falava o parâmetro antigo. `max_completion_tokens`
        // é aceito por TODOS os modelos de chat completions atuais (substituiu
        // `max_tokens` para a família inteira, não só para os de raciocínio).
        //
        // 16, não 1: nos modelos de raciocínio o teto cobre os tokens de
        // raciocínio ANTES do texto visível — com 1 o modelo gasta o teto
        // inteiro pensando e nunca chega a emitir nada, e a API devolve erro
        // (`model output limit was reached`) mesmo com a chave em dia. 16 dá
        // fôlego pro modelo mais leve da família terminar; para o de
        // raciocínio mais pesado, `classificarResposta` reconhece esse erro
        // específico como prova válida mesmo assim (a cobrança já passou).
        body: { model: modelo, max_completion_tokens: 16, messages: msg },
      };
    case "openrouter":
      return {
        url: `${baseUrl ?? OPENROUTER_ENDPOINT}/chat/completions`,
        // Os mesmos cabeçalhos de atribuição dos outros dois caminhos. Este era
        // o terceiro call site de OpenRouter e tinha ficado de fora — se os
        // headers fossem requisito de funcionamento, como o corpo do PR #266
        // supôs, a prova de crédito da instalação estaria falhando hoje. Ela
        // não está: são atribuição, e por isso ficam opcionais aqui também.
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...cabecalhosDeAtribuicaoOpenRouter(),
        },
        body: { model: modelo, max_tokens: 1, messages: msg },
      };
    case "google":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          modelo,
        )}:generateContent?key=${encodeURIComponent(apiKey)}`,
        headers: { "content-type": "application/json" },
        body: {
          contents: [{ parts: [{ text: "oi" }] }],
          generationConfig: { maxOutputTokens: 1 },
        },
      };
    default:
      // Fail-closed: provedor que este módulo não sabe cobrar não recebe um
      // "ok" por omissão — seria a frase tranquilizadora de novo.
      return null;
  }
}

/**
 * Erro específico de modelo de raciocínio (OpenAI o1/o3, gpt-5...) quando o
 * teto de tokens acaba nos tokens de PENSAR antes de emitir texto visível.
 * Não é o modelo recusando a chamada por falta de saldo — é o request tendo
 * PASSADO pela cobrança e começado a gerar. Tratar como falha reproduziria o
 * mesmo diagnóstico errado ("adicione saldo") que motivou trocar `max_tokens`
 * por `max_completion_tokens`: o teto pequeno demais para este modelo, não a
 * conta vazia.
 */
const SAIDA_ESGOTADA_POR_RACIOCINIO = /max_tokens or model output limit was reached/i;

/** Traduz a resposta HTTP no mesmo vocabulário de erro do runtime. */
export function classificarResposta(status: number, corpo: string): ResultadoDaProva {
  if (status >= 200 && status < 300) return { ok: true };
  if (SAIDA_ESGOTADA_POR_RACIOCINIO.test(corpo)) return { ok: true };
  // `normalizarErro` lê `status` do objeto — é a régua canônica, compartilhada
  // com a tela de Execuções, e ela também redige a mensagem do provedor (que
  // pode ecoar header de autorização em endpoint próprio).
  const err = Object.assign(new Error(corpo), { status });
  const n = normalizarErro(err);
  return {
    ok: false,
    codigo: n.error_code,
    mensagem: n.error_message,
    httpStatus: n.http_status,
  };
}

const TIMEOUT_MS = 8000;

export async function provarSaldo(
  provider: string,
  apiKey: string,
  modelo: string,
  opcoes?: { baseUrl?: string; fetchImpl?: typeof fetch },
): Promise<ResultadoDaProva> {
  const req = montarRequisicaoDeProva(provider, apiKey, modelo, opcoes?.baseUrl);
  if (!req) {
    return {
      ok: false,
      codigo: "provedor_desconhecido",
      mensagem: `Não sei como testar o provedor "${provider}".`,
      httpStatus: null,
    };
  }

  const f = opcoes?.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await f(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ctrl.signal,
    });
    const corpo = await res.text().catch(() => "");
    return classificarResposta(res.status, corpo);
  } catch (err) {
    // Rede fora, DNS, timeout: NÃO é chave ruim, e dizer que é mandaria o
    // operador trocar uma chave que está certa.
    const n = normalizarErro(err);
    return { ok: false, codigo: n.error_code, mensagem: n.error_message, httpStatus: n.http_status };
  } finally {
    clearTimeout(timer);
  }
}
