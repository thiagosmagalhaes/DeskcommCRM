-- ============================================================================
-- 0177 — UPLOAD EM LOTE DE DOCUMENTOS .MD, E O GAP DE INDEXAÇÃO QUE ISSO EXPÕE.
--
-- Duas coisas amarradas pelo mesmo defeito:
--
-- 1) A tela "Fontes de Conhecimento" só tinha 4 slots fixos (faq, policy,
--    conversations, catalog) — um por tipo, por causa do índice único
--    `ai_knowledge_sources_unique_per_agent (agent_id, source_type) WHERE
--    is_active`. Não havia como subir vários documentos .md de uma vez
--    (manuais, roteiros, procedimentos) sem forçar tudo num único blob de
--    texto colado. `source_type` ganha o valor 'documents', e a tabela nova
--    `ai_document_items` guarda um arquivo por linha — mesmo desenho de
--    `ai_faq_items` (pergunta/resposta vira nome/conteúdo) — todos amarrados
--    à MESMA fonte 'documents' do agente. O índice único continua valendo
--    como está; o card novo é que passa a listar vários arquivos dentro de
--    UMA fonte, em vez de forçar uma fonte por arquivo.
--
-- 2) `app/api/v1/ai/knowledge/sources/upload/route.ts` (upload de PDF/MD de
--    política) já existia e extrai/conta chunks — mas SÓ para validar antes
--    de aceitar o upload; o conteúdo nunca era gravado em lugar consultável.
--    `workers/rag-indexer.ts` (`handleKnowledgeSourceUpdated`) só lia
--    `ai_faq_items` para montar a base — então assim que o
--    `knowledge_source.updated` do próprio upload disparava, o worker
--    reindexava, não achava nenhum item da fonte, e marcava
--    `last_index_status='failed'`: o arquivo enviado nunca chegava ao agente,
--    e a tela nem mostrava por quê. `ai_document_items` é o lugar consultável
--    que faltava — o worker (mudança em código, fora desta migration) passa a
--    ler também esta tabela para fontes do tipo 'documents'.
--
-- A constraint de vocabulário ganha bloco PRÓPRIO no apêndice do baseline
-- (não existia nenhum até agora — só a definição inline do CREATE TABLE do
-- snapshot original, que `update.sh` não re-executa porque é
-- `IF NOT EXISTS`). Dali em diante, quem ampliar o vocabulário edita ESTE
-- bloco em vez de empilhar um novo — mesma disciplina de
-- `agent_inbox_items_kind_check` (ver `tests/unit/baseline-constraint-reconstruida.test.ts`).
-- ============================================================================

alter table public.ai_knowledge_sources
  drop constraint if exists ai_knowledge_sources_source_type_check;

alter table public.ai_knowledge_sources
  add constraint ai_knowledge_sources_source_type_check check (source_type in (
    'faq', 'policy', 'catalog', 'conversations', 'conversation', 'nuvemshop_catalog', 'documents'
  ));

create table if not exists public.ai_document_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  knowledge_source_id uuid not null references public.ai_knowledge_sources(id) on delete cascade,
  filename text not null,
  content text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_document_items_filename_per_source_unique unique (knowledge_source_id, filename)
);

create index if not exists ai_document_items_org_idx
  on public.ai_document_items (organization_id);
create index if not exists ai_document_items_source_idx
  on public.ai_document_items (knowledge_source_id, position);

comment on table public.ai_document_items is
  'Um arquivo .md por linha, amarrado a UMA fonte ai_knowledge_sources do tipo ''documents''. '
  'Mesmo desenho de ai_faq_items (pergunta/resposta -> nome/conteúdo): o card lista vários '
  'arquivos dentro de uma única fonte, sem precisar relaxar o índice único por (agent_id, source_type).';

alter table public.ai_document_items enable row level security;

drop policy if exists "tenant_isolation_ai_document_items_all" on public.ai_document_items;
create policy "tenant_isolation_ai_document_items_all" on public.ai_document_items
  using (
    public.fn_is_platform_admin()
    or organization_id in (select public.fn_user_org_ids())
  )
  with check (
    public.fn_is_platform_admin()
    or organization_id in (select public.fn_user_org_ids())
  );

drop trigger if exists ai_document_items_updated_at on public.ai_document_items;
create trigger ai_document_items_updated_at
  before update on public.ai_document_items
  for each row execute function public.fn_set_updated_at();
