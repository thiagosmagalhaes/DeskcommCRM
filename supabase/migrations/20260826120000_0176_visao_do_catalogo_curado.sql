-- ============================================================================
-- 0176 — O CATÁLOGO CURADO DIZIA QUE NENHUM MODELO ENXERGA IMAGEM.
--
-- A migration 0127 acrescentou `ai_models.supports_vision boolean not null
-- default false`, e nenhuma migration depois disso jamais setou `true`: as
-- inserções do catálogo curado (`source = 'manual'` — migrations 0023 e 0104,
-- Anthropic/OpenAI/Google) listam `supports_tools` mas nunca `supports_vision`,
-- então toda linha nasceu (e continuou) `false` — inclusive os flagships atuais
-- (`claude-sonnet-5`, `claude-opus-5`, `gpt-5.6-*`, `gemini-3.*`).
--
-- O efeito chega ao operador em `lib/ai/pontos/validar-binding.ts`: ao
-- configurar "Ver a imagem do cliente" (ponto `visao_de_imagem`) para
-- `claude-sonnet-5`, o painel de Provedores avisa "claude-sonnet-5 não enxerga
-- imagens" — uma alegação falsa, lida do próprio catálogo que o produto cura.
-- Pior: `workers/media-derive-worker.ts` consulta a MESMA coluna em runtime
-- (`modelCapabilities`/`resolveOrgLlmConfig`) para decidir se manda a foto como
-- parte nativa — então o comprovante do cliente era descartado e o worker
-- gravava "[o cliente enviou uma mídia que não consegui interpretar]" mesmo com
-- um modelo que sabe ler imagem.
--
-- ─── Por que "todo modelo manual das três famílias", e não uma lista nomeada ──
--
-- `lib/agent-engine/edge/llm/capabilities.ts` já declara esta mesma regra como
-- verdade do produto: "Famílias flagship dos 3 providers aceitam imagem+pdf via
-- content parts da AI SDK" — `anthropic`/`openai`/`google` são NATIVE por
-- default, com uma deny-list pequena para o que não é chat multimodal
-- (embedding/tts/whisper/moderation). O catálogo curado só cadastra modelo de
-- CHAT dessas três famílias — nenhuma linha `source='manual'` hoje casa a
-- deny-list —, então a correção certa é a mesma regra, aplicada à tabela:
-- corrige o presente E qualquer entrada futura que caia sob a mesma condição
-- continua correta sem precisar de outra migration.
--
-- Aditivo e idempotente: um UPDATE por condição, sem CHECK novo, sem coluna
-- nova. Reaplicar não muda o resultado.
-- ============================================================================

update public.ai_models
   set supports_vision = true
 where source = 'manual'
   and provider in ('anthropic', 'openai', 'google')
   and model_id !~* '(embedding|tts|whisper|moderation)'
   and supports_vision = false;
