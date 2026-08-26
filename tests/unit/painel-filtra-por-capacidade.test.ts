/**
 * O seletor de modelo do painel de Provedores não pode oferecer o que o
 * catálogo já sabe que vai falhar.
 *
 * Antes desta regra, "Ver a imagem do cliente" (`visao_de_imagem`, `exige:
 * {imagem:true}`) listava QUALQUER modelo de chat do provedor escolhido — o
 * operador escolhia `claude-sonnet-5`, clicava em Salvar, e só ALI a tela
 * dizia "claude-sonnet-5 não enxerga imagens" (`validar-binding.ts`). A mesma
 * regra que recusa na escrita (para `tools`) e avisa na leitura (para
 * `imagem`) agora filtra o seletor ANTES do clique — `modeloAtendeExigencia`
 * é a função única que os dois lados (painel e `validarBinding`) compartilham,
 * para não divergirem de novo.
 */
import { describe, expect, it } from "vitest";

import { modeloAtendeExigencia } from "@/lib/ai/pontos/validar-binding";

const COM_TUDO = { supports_tools: true, supports_vision: true };
const SO_TEXTO = { supports_tools: false, supports_vision: false };
const SO_FERRAMENTAS = { supports_tools: true, supports_vision: false };
const SO_VISAO = { supports_tools: false, supports_vision: true };

describe("modeloAtendeExigencia", () => {
  it("ponto sem exigência aceita qualquer modelo", () => {
    expect(modeloAtendeExigencia({}, SO_TEXTO)).toBe(true);
  });

  it("exige ferramentas: recusa modelo sem tool calling", () => {
    expect(modeloAtendeExigencia({ tools: true }, SO_TEXTO)).toBe(false);
    expect(modeloAtendeExigencia({ tools: true }, SO_VISAO)).toBe(false);
    expect(modeloAtendeExigencia({ tools: true }, SO_FERRAMENTAS)).toBe(true);
  });

  it("exige imagem: recusa modelo que não enxerga — o caso do bug relatado", () => {
    // A forma exata do defeito: um modelo real (aqui representado pelas
    // flags, não pelo nome) sem `supports_vision`, oferecido a um ponto que
    // `exige.imagem === true`.
    expect(modeloAtendeExigencia({ imagem: true }, SO_TEXTO)).toBe(false);
    expect(modeloAtendeExigencia({ imagem: true }, SO_FERRAMENTAS)).toBe(false);
    expect(modeloAtendeExigencia({ imagem: true }, SO_VISAO)).toBe(true);
  });

  it("exige as duas: só o modelo completo passa", () => {
    expect(modeloAtendeExigencia({ tools: true, imagem: true }, SO_FERRAMENTAS)).toBe(false);
    expect(modeloAtendeExigencia({ tools: true, imagem: true }, SO_VISAO)).toBe(false);
    expect(modeloAtendeExigencia({ tools: true, imagem: true }, COM_TUDO)).toBe(true);
  });

  it("embeddingDims não é checado aqui — é o outro tipo de exigência, sem flag booleana", () => {
    expect(modeloAtendeExigencia({ embeddingDims: 1536 }, SO_TEXTO)).toBe(true);
  });
});
