-- 0178: split de mensagens por parágrafo — remove o teto de tamanho por bolha.
--
-- `split_max_chars` (migration 0059) pedia um número de caracteres que não
-- correspondia a nada que a pessoa escrevia: a instrução real do agente é em
-- parágrafos, e o teto fazia `splitIntoBubbles` juntar/quebrar por sentença
-- e por palavra até caber — comportamento que a tela nunca explicava, só o
-- rótulo "80–4000". `splitIntoBubbles` passa a ser puro por parágrafo
-- (`\n\n` = bolha nova, sem limite de tamanho); a coluna fica sem leitor.
--
-- `split_messages` continua — é o liga/desliga do recurso, não o tamanho.
alter table public.ai_agent_versions
  drop column if exists split_max_chars;

-- `fn_ai_agent_version_content_immutable` (migration 0125) checava
-- `split_max_chars` na lista de colunas imutáveis pós-publicação. A coluna
-- não existe mais: recria a função sem essa linha (mesma assinatura, mesmo
-- trigger já apontado para ela).
create or replace function public.fn_ai_agent_version_content_immutable() returns trigger
language plpgsql as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;
