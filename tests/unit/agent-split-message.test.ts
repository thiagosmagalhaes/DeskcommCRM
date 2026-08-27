// tests/unit/agent-split-message.test.ts
import { describe, expect, it } from "vitest";

import { splitIntoBubbles } from "@/lib/agent-engine/agent/split-message";

describe("splitIntoBubbles", () => {
  it("texto curto sem parágrafo vira uma bolha só (trim)", () => {
    expect(splitIntoBubbles("  Olá, tudo bem?  ")).toEqual(["Olá, tudo bem?"]);
  });
  it("vazio/whitespace → []", () => {
    expect(splitIntoBubbles("")).toEqual([]);
    expect(splitIntoBubbles("   \n  ")).toEqual([]);
  });
  it("cada parágrafo (\\n\\n) vira uma bolha", () => {
    const out = splitIntoBubbles("Primeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro.");
    expect(out).toEqual(["Primeiro parágrafo.", "Segundo parágrafo.", "Terceiro."]);
  });
  it("uma sentença longa dentro do mesmo parágrafo não é quebrada", () => {
    const text = "Oi! Como você está hoje? Queria falar do seu pedido. Ele já saiu para entrega.";
    const out = splitIntoBubbles(text);
    expect(out).toEqual([text]);
  });
  it("quebras de linha simples (\\n) não separam bolha — só \\n{2,}", () => {
    const out = splitIntoBubbles("Linha um.\nLinha dois ainda no mesmo parágrafo.");
    expect(out).toEqual(["Linha um.\nLinha dois ainda no mesmo parágrafo."]);
  });
  it("três ou mais quebras de linha também contam como separador de parágrafo", () => {
    const out = splitIntoBubbles("Um.\n\n\nDois.");
    expect(out).toEqual(["Um.", "Dois."]);
  });
  it("parágrafo vazio entre dois não vazios não vira bolha em branco", () => {
    const out = splitIntoBubbles("Um.\n\n   \n\nDois.");
    expect(out).toEqual(["Um.", "Dois."]);
  });
});
