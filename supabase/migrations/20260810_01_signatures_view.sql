-- ============================================================
-- FASE 1: view para a tela de Assinaturas
-- ============================================================
-- Resolve o bug do SP5 (e de outras 17 unidades): a tela fazia o join
-- entre collaborators e trainings_completed no CLIENTE, montando um filtro
-- .in(collaborator_id, [...919 ids]) cuja URL passava de 34 KB e o Supabase
-- rejeitava com HTTP 400. Esta view deixa o Postgres fazer o join, e a
-- tela passa a filtrar/paginar direto nela — sem montar listas de IDs.
--
-- Não inclui signature_pdf_url (base64, ~28 KB em média por registro):
-- a tela busca a imagem sob demanda só quando o usuário abre "ver" ou
-- "baixar". Isso também resolve o tráfego de ~247 MB por carregamento
-- da tela de Relatórios (troque a leitura de lá para o mesmo padrão
-- quando for arrumar ReportsPage).
--
-- security_invoker = true: a view roda com o RLS de quem consulta,
-- não do dono da view. Sem isso, a view herdaria os privilégios de
-- quem a criou e ignoraria o RLS das tabelas de baixo.
-- ============================================================

create or replace view public.signatures_view
with (security_invoker = true) as
select
  tc.id,
  tc.collaborator_id,
  tc.training_type,
  tc.instructor_name,
  tc.completed_at,
  tc.created_at,
  (tc.signature_pdf_url is not null) as has_signature,
  c.name   as collaborator_name,
  c.sector as collaborator_sector,
  c.soc    as collaborator_soc,
  c.role   as collaborator_role
from public.trainings_completed tc
join public.collaborators c on c.id = tc.collaborator_id;

grant select on public.signatures_view to authenticated;

-- Índices de apoio: sem eles, todo filtro acima faz sequential scan.
-- GO2 e SP6 já passam de 1.300 colaboradores / 2.000+ assinaturas.
create index if not exists idx_collaborators_soc               on public.collaborators (soc);
create index if not exists idx_trainings_completed_collab_id    on public.trainings_completed (collaborator_id);
create index if not exists idx_trainings_completed_training     on public.trainings_completed (training_type);
create index if not exists idx_trainings_completed_instructor   on public.trainings_completed (instructor_name);
create index if not exists idx_trainings_completed_completed_at on public.trainings_completed (completed_at desc);
