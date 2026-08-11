-- ============================================================
-- Snapshot do colaborador em trainings_completed
-- ============================================================
-- Motivação: no incidente de 11/08, 13.880 assinaturas perderam o vínculo
-- com o colaborador (collaborator_id virou NULL) e ficaram sem identidade
-- nenhuma — a tabela só guardava a referência, nunca quem era a pessoa.
--
-- A partir de agora, todo INSERT/UPDATE de collaborator_id GRAVA JUNTO uma
-- cópia congelada do nome, OPS ID e SOC da pessoa. Se o vínculo se perder
-- de novo — por exclusão via sync, por qualquer motivo — a assinatura
-- continua identificável sem depender de backup.
--
-- Pode rodar mesmo que já tenha sido aplicada (idempotente).
-- ============================================================

alter table public.trainings_completed
  add column if not exists collaborator_name  text,
  add column if not exists collaborator_opsid text,
  add column if not exists collaborator_soc   text;

comment on column public.trainings_completed.collaborator_name is
  'Nome do colaborador no momento da assinatura — preenchido automaticamente pelo trigger snapshot_collaborator_on_training. Sobrevive mesmo se collaborator_id virar NULL.';
comment on column public.trainings_completed.collaborator_soc is
  'SOC do colaborador no momento da assinatura — mesma lógica de collaborator_name. Usada para RLS de registros órfãos (ver migração de RLS).';

-- ── Backfill dos registros existentes ────────────────────────────
-- Preenche quem ainda tem collaborator_id válido. Quem já está órfão
-- (collaborator_id NULL) não tem como ser preenchido por aqui — é
-- exatamente o problema que esta migração resolve dali para frente.
update public.trainings_completed tc
set collaborator_name  = c.name,
    collaborator_opsid = c.opsid,
    collaborator_soc   = c.soc
from public.collaborators c
where tc.collaborator_id = c.id
  and tc.collaborator_name is null;

-- ── Trigger: mantém o snapshot atualizado automaticamente ────────
-- Só age quando NEW.collaborator_id não é nulo — por isso, quando um
-- DELETE em collaborators dispara o ON DELETE SET NULL desta FK, o
-- snapshot já gravado NÃO é apagado (o trigger não toca nas colunas
-- quando NEW.collaborator_id chega NULL).
create or replace function public.snapshot_collaborator_on_training()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.collaborator_id is not null then
    select name, opsid, soc
      into new.collaborator_name, new.collaborator_opsid, new.collaborator_soc
      from public.collaborators
      where id = new.collaborator_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_collaborator on public.trainings_completed;
create trigger trg_snapshot_collaborator
  before insert or update of collaborator_id on public.trainings_completed
  for each row
  execute function public.snapshot_collaborator_on_training();

-- ── signatures_view: registros órfãos voltam a aparecer ──────────
-- Antes era INNER JOIN — um collaborator_id nulo excluía a linha por
-- completo. Agora é LEFT JOIN com o snapshot como reserva: se o vínculo
-- vivo existir, usa ele (sempre atual); se não existir mais, usa o nome
-- congelado no momento da assinatura.
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
  coalesce(c.name, tc.collaborator_name) as collaborator_name,
  c.sector as collaborator_sector,
  coalesce(c.soc, tc.collaborator_soc) as collaborator_soc,
  c.role as collaborator_role,
  (c.id is null) as collaborator_removed
from public.trainings_completed tc
left join public.collaborators c on c.id = tc.collaborator_id;

grant select on public.signatures_view to authenticated;

create index if not exists idx_trainings_completed_collaborator_soc on public.trainings_completed (collaborator_soc);

select '✅ Snapshot de colaborador ativo. Rode o backfill de órfãos históricos manualmente (scripts/backfill_orphan_snapshots.mjs) se quiser tentar reidentificar os 13.880 registros do incidente por outra fonte.' as status;
