-- ============================================================
-- Regionais: agrupamento de SOCs (09/10/2026)
-- ============================================================
-- Pedido do master: criar regionais na tela de Configurações ("Regional 1"
-- = as SOCs de São Paulo metrópole, "Regional 2" = as do interior...) e
-- filtrar a tela de Relatórios por regional.
--
-- ── MODELO ───────────────────────────────────────────────────
-- Cada SOC pertence a no máximo UMA regional: socs.regional_id. Atrelar uma
-- SOC a outra regional a MOVE (não existe SOC em duas regionais, o que
-- faria a mesma pessoa contar duas vezes numa soma por regional). Apagar uma
-- regional solta as SOCs dela (on delete set null) — nenhuma unidade é
-- apagada junto.
--
-- ── QUEM MEXE ────────────────────────────────────────────────
-- Criar, renomear e apagar regional: admin e master — o mesmo critério da
-- política admin_write_socs, que já é a que autoriza gravar
-- socs.regional_id (atrelar e soltar SOCs). Ler: qualquer usuário logado,
-- porque o filtro dos Relatórios precisa da lista.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

create table if not exists public.regionais (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  created_at timestamptz not null default now(),
  constraint regionais_nome_preenchido check (btrim(nome) <> '')
);

-- "Regional 1" e "REGIONAL 1 " são a mesma regional.
create unique index if not exists idx_regionais_nome_unico
  on public.regionais (upper(btrim(nome)));

comment on table public.regionais is
  'Agrupamento de SOCs (Regional 1 = SP metrópole, Regional 2 = SP interior...). Cada SOC aponta para a sua em socs.regional_id. Gerenciada em Configurações por admin e master; usada no filtro de Relatórios. Ver 20261009_01.';

alter table public.socs
  add column if not exists regional_id uuid
  references public.regionais(id) on delete set null;

create index if not exists idx_socs_regional_id on public.socs (regional_id);

comment on column public.socs.regional_id is
  'Regional desta SOC (no máximo uma). Null = sem regional. Apagar a regional volta para null. Ver 20261009_01.';

-- ── Acesso ───────────────────────────────────────────────────
alter table public.regionais enable row level security;

drop policy if exists regionais_leitura on public.regionais;
create policy regionais_leitura on public.regionais
  for select to authenticated
  using (true);

drop policy if exists regionais_escrita on public.regionais;
create policy regionais_escrita on public.regionais
  for all to authenticated
  using ((select public.current_user_role()) = any (array['admin', 'master']))
  with check ((select public.current_user_role()) = any (array['admin', 'master']));

-- Quem não está logado não tem o que fazer com regionais.
revoke all on public.regionais from anon;
grant select, insert, update, delete on public.regionais to authenticated;
