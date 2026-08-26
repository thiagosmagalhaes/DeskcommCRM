/**
 * PUT /api/v1/ai/providers/padrao — o padrão de IA da ORGANIZAÇÃO inteira.
 *
 * `organizations.settings.llm.{provider,default_model}` é o que `decidirBinding`
 * (`lib/ai/pontos/resolver.ts`, ramo 4) usa para QUALQUER ponto sem binding
 * próprio e sem variável de ambiente — ou seja, para a maioria dos ~20 pontos de
 * IA do produto até alguém configurar cada um em "Configuração avançada". Até
 * esta rota existir, a única forma de trocar esse padrão era um UPDATE direto no
 * banco: o instalador grava a escolha do wizard (`scripts/bootstrap-owner.ts`) e
 * o trigger `fn_seed_org_llm_defaults` semeia `'anthropic'` fixo em toda
 * organização nova — quem não passou pelo wizard com `AI_PROVIDER` setado (ou
 * mudou de ideia depois), ou uma instalação existente que só tem chave de outro
 * provedor, ficava com todo ponto não-configurado tentando falar com um provedor
 * sem chave nenhuma, sem um lugar na tela para corrigir isso de uma vez.
 *
 * Fica FORA do PUT de `../route.ts` de propósito: aquele valida contra
 * `PONTO_POR_ID` e grava em `ai_purpose_bindings` (por PONTO); este não é um
 * ponto, é o que os pontos herdam quando não dizem nada. Payloads e tabelas
 * diferentes — misturar os dois num handler só faria o schema Zod mentir sobre
 * o que cada campo significa.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { ehProvedorSuportado } from "@/lib/ai/pontos/provedores";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoDoPut = z.object({
  provider: z
    .string()
    .min(1)
    .refine(ehProvedorSuportado, {
      message:
        "provedor não suportado por esta instalação — escolha um da lista em Agente de IA → Provedores",
    }),
  default_model: z.string().min(1).nullable(),
});

export async function PUT(req: NextRequest): Promise<Response> {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) return fail("no_active_org", "nenhuma organização ativa", 400);
  if (ROLE_RANK[org.role] < ROLE_RANK.admin) {
    return fail("forbidden", "requer papel de administrador", 403);
  }

  const parsed = corpoDoPut.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_body", "corpo inválido", 422, { details: parsed.error.issues });
  }
  const corpo = parsed.data;

  // ESCRITA EM `organizations` VAI PELO ADMIN CLIENT, e o motivo é o mesmo de
  // `app/actions/settings/updateTenant.ts`: a única policy de escrita da tabela
  // é `orgs_write_platform_admin` (`USING (fn_is_platform_admin())`), então pelo
  // client de sessão o UPDATE de um admin de TENANT (não de plataforma) casa
  // ZERO linhas — e o PostgREST devolve sucesso sobre nada gravado. O gate de
  // papel já aconteceu acima, de fonte confiável (a sessão resolvida), e o
  // filtro por `organization_id` abaixo é explícito, como a doutrina exige de
  // todo handler que usa service role.
  const admin = createAdminClient();

  const { data: orgRow, error: readErr } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", org.orgId)
    .maybeSingle();
  if (readErr) return fail("read_failed", readErr.message, 500);

  const settings = (orgRow?.settings as Record<string, unknown> | null) ?? {};
  const llm = (settings["llm"] as Record<string, unknown> | undefined) ?? {};

  const { error } = await admin
    .from("organizations")
    .update({
      settings: {
        ...settings,
        llm: { ...llm, provider: corpo.provider, default_model: corpo.default_model },
      },
    })
    .eq("id", org.orgId);
  if (error) return fail("save_failed", error.message, 500);

  void audit({
    action: "ai.org_default_updated",
    organizationId: org.orgId,
    actorUserId: user.id,
    resourceType: "organization",
    resourceId: org.orgId,
    metadata: {
      provider: corpo.provider,
      default_model: corpo.default_model,
    },
  });

  return ok({ provider: corpo.provider, defaultModel: corpo.default_model });
}
