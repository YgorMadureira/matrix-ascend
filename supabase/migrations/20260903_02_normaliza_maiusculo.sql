-- ============================================================
-- Todo texto de conteúdo, em MAIÚSCULO — independente de como entrou
-- ============================================================
-- Pedido de 03/09/2026: nome de colaborador, setor, cargo, líder,
-- treinamento, instrutor, SOC, pasta/material, usuário do sistema etc
-- devem ficar gravados em MAIÚSCULO, não importa se vieram de um
-- formulário digitado à mão, de uma importação de CSV/XLSX, da
-- sincronização diária com o Google Sheets ou da página pública de
-- assinatura.
--
-- ⚠️ PRÉ-REQUISITO JÁ EXECUTADO: 188 colaboradores estavam duplicados no
-- banco só por causa de diferença de maiúsculo/minúsculo no nome (ex.:
-- "Erika de Jesus..." e "ERIKA DE JESUS..." na mesma SOC) — foram
-- mesclados por scripts/mesclar_duplicados_collaborators.mjs ANTES desta
-- migração rodar. Se esta migração falhar num `unique_violation` em
-- collaborators, é sinal de que apareceu duplicidade nova desde então —
-- rode aquele script de novo (modo simulação primeiro) antes de repetir.
--
-- POR QUE UM TRIGGER POR TABELA, E NÃO SÓ CORRIGIR CADA TELA:
-- O sistema tem 20+ pontos que gravam texto (5 páginas React, 2 Edge
-- Functions, o parser de CSV) e pelo menos 15 deles não normalizavam nada
-- até agora. Corrigir tela por tela repete o erro do incidente de líderes
-- de 02/09/2026 (ver 20260902_01_protege_lideres_da_exclusao.sql): uma
-- proteção que vive só no código da aplicação depende do deploy estar em
-- dia. Aqui a regra vai pro banco, no mesmo padrão de guard_leader_deletion
-- / guard_master_role / guard_soc_access — vale pra qualquer forma de
-- entrada, presente ou futura, sem precisar tocar em cada tela.
--
-- Cada tabela tem sua PRÓPRIA função de trigger (em vez de uma função
-- genérica com SQL dinâmico) — mais verboso, mas cada uma é uma lista
-- direta de `NEW.coluna := upper(NEW.coluna)`, sem nenhuma camada de
-- indireção pra dar errado.
--
-- BÔNUS: como um trigger BEFORE INSERT dispara ANTES da resolução do
-- ON CONFLICT no Postgres, isto também corrige, de quebra, a causa raiz
-- dos 188 duplicados: a partir de agora, mesmo que a planilha do Sheets
-- mande "erika de jesus..." com caixa diferente da que já está gravada, o
-- valor chega maiúsculo ANTES do Postgres decidir se é conflito — o
-- upsert (name, soc) da sincronização passa a casar certo com a linha
-- existente, em vez de criar uma pessoa nova.
--
-- O QUE FICA DE FORA (não é "conteúdo"): email, senha, video_url,
-- file_url, todo id/uuid, opsid, leader_id/folder_id/training_id/etc,
-- google_event_id, signature_pdf_url, status/enum/boolean/timestamp. E
-- sync_locks.* (mensagens de diagnóstico geradas pelo próprio sistema, não
-- dado que alguém digitou) — se quiser incluir depois, é só mais uma
-- função no mesmo padrão abaixo.
--
-- upper() deste banco já trata acento corretamente — testado em produção:
-- upper('Onboarding Liderança 2.0') = 'ONBOARDING LIDERANÇA 2.0'.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

-- ── collaborators ──────────────────────────────────────────
create or replace function public.normalize_collaborators_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.name     := upper(NEW.name);
  NEW.gender   := upper(NEW.gender);
  NEW.sector   := upper(NEW.sector);
  NEW.shift    := upper(NEW.shift);
  NEW.leader   := upper(NEW.leader);
  NEW.role     := upper(NEW.role);
  NEW.bpo      := upper(NEW.bpo);
  NEW.activity := upper(NEW.activity);
  NEW.soc      := upper(NEW.soc);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.collaborators;
create trigger trg_normalize_uppercase
  before insert or update on public.collaborators
  for each row
  execute function public.normalize_collaborators_uppercase();

-- ── trainings_completed ────────────────────────────────────
-- collaborator_name/collaborator_soc (snapshot) NÃO entram aqui: são
-- preenchidas por trg_snapshot_collaborator a partir de collaborators, que
-- já está normalizado por este trigger acima — nascem corretas sozinhas.
create or replace function public.normalize_trainings_completed_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.training_type   := upper(NEW.training_type);
  NEW.instructor_name := upper(NEW.instructor_name);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.trainings_completed;
create trigger trg_normalize_uppercase
  before insert or update on public.trainings_completed
  for each row
  execute function public.normalize_trainings_completed_uppercase();

-- ── trainings ───────────────────────────────────────────────
create or replace function public.normalize_trainings_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.name := upper(NEW.name);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.trainings;
create trigger trg_normalize_uppercase
  before insert or update on public.trainings
  for each row
  execute function public.normalize_trainings_uppercase();

-- ── training_folders ───────────────────────────────────────
create or replace function public.normalize_training_folders_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.name := upper(NEW.name);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.training_folders;
create trigger trg_normalize_uppercase
  before insert or update on public.training_folders
  for each row
  execute function public.normalize_training_folders_uppercase();

-- ── folders ─────────────────────────────────────────────────
create or replace function public.normalize_folders_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.name := upper(NEW.name);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.folders;
create trigger trg_normalize_uppercase
  before insert or update on public.folders
  for each row
  execute function public.normalize_folders_uppercase();

-- ── materials ───────────────────────────────────────────────
create or replace function public.normalize_materials_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.name        := upper(NEW.name);
  NEW.description := upper(NEW.description);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.materials;
create trigger trg_normalize_uppercase
  before insert or update on public.materials
  for each row
  execute function public.normalize_materials_uppercase();

-- ── socs ────────────────────────────────────────────────────
create or replace function public.normalize_socs_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.name        := upper(NEW.name);
  NEW.pts_name    := upper(NEW.pts_name);
  NEW.site_leader := upper(NEW.site_leader);
  NEW.address     := upper(NEW.address);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.socs;
create trigger trg_normalize_uppercase
  before insert or update on public.socs
  for each row
  execute function public.normalize_socs_uppercase();

-- ── instructors ─────────────────────────────────────────────
create or replace function public.normalize_instructors_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.name := upper(NEW.name);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.instructors;
create trigger trg_normalize_uppercase
  before insert or update on public.instructors
  for each row
  execute function public.normalize_instructors_uppercase();

-- ── quiz_questions ──────────────────────────────────────────
create or replace function public.normalize_quiz_questions_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.question   := upper(NEW.question);
  NEW.option_a   := upper(NEW.option_a);
  NEW.option_b   := upper(NEW.option_b);
  NEW.option_c   := upper(NEW.option_c);
  NEW.option_d   := upper(NEW.option_d);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.quiz_questions;
create trigger trg_normalize_uppercase
  before insert or update on public.quiz_questions
  for each row
  execute function public.normalize_quiz_questions_uppercase();

-- ── users_profiles ──────────────────────────────────────────
-- full_name/leader_key: nomes de quem faz login (admin/master/líder/bpo/
-- pcp) entram na mesma regra — decisão de 03/09/2026.
create or replace function public.normalize_users_profiles_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.full_name  := upper(NEW.full_name);
  NEW.leader_key := upper(NEW.leader_key);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.users_profiles;
create trigger trg_normalize_uppercase
  before insert or update on public.users_profiles
  for each row
  execute function public.normalize_users_profiles_uppercase();

-- ── training_schedules ──────────────────────────────────────
create or replace function public.normalize_training_schedules_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.title           := upper(NEW.title);
  NEW.instructor_name := upper(NEW.instructor_name);
  NEW.soc             := upper(NEW.soc);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.training_schedules;
create trigger trg_normalize_uppercase
  before insert or update on public.training_schedules
  for each row
  execute function public.normalize_training_schedules_uppercase();

-- ── training_schedule_enrollments ──────────────────────────
create or replace function public.normalize_training_schedule_enrollments_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.collaborator_name := upper(NEW.collaborator_name);
  NEW.enrolled_by_name  := upper(NEW.enrolled_by_name);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.training_schedule_enrollments;
create trigger trg_normalize_uppercase
  before insert or update on public.training_schedule_enrollments
  for each row
  execute function public.normalize_training_schedule_enrollments_uppercase();

-- ── schedule_audit_log ──────────────────────────────────────
create or replace function public.normalize_schedule_audit_log_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.schedule_title    := upper(NEW.schedule_title);
  NEW.collaborator_name := upper(NEW.collaborator_name);
  NEW.performed_by      := upper(NEW.performed_by);
  NEW.action            := upper(NEW.action);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.schedule_audit_log;
create trigger trg_normalize_uppercase
  before insert or update on public.schedule_audit_log
  for each row
  execute function public.normalize_schedule_audit_log_uppercase();

-- ── training_scheduling_requests ───────────────────────────
create or replace function public.normalize_training_scheduling_requests_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.instructor_name   := upper(NEW.instructor_name);
  NEW.requested_by_name := upper(NEW.requested_by_name);
  NEW.notes             := upper(NEW.notes);
  NEW.rejection_reason  := upper(NEW.rejection_reason);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.training_scheduling_requests;
create trigger trg_normalize_uppercase
  before insert or update on public.training_scheduling_requests
  for each row
  execute function public.normalize_training_scheduling_requests_uppercase();

-- ── training_scheduling_request_collaborators ──────────────
create or replace function public.normalize_training_scheduling_request_collaborators_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.collaborator_name := upper(NEW.collaborator_name);
  NEW.rejection_reason  := upper(NEW.rejection_reason);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.training_scheduling_request_collaborators;
create trigger trg_normalize_uppercase
  before insert or update on public.training_scheduling_request_collaborators
  for each row
  execute function public.normalize_training_scheduling_request_collaborators_uppercase();

-- ── soc_micro_trainings ─────────────────────────────────────
create or replace function public.normalize_soc_micro_trainings_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.name       := upper(NEW.name);
  NEW.macro_area := upper(NEW.macro_area);
  return NEW;
end;
$$;

drop trigger if exists trg_normalize_uppercase on public.soc_micro_trainings;
create trigger trg_normalize_uppercase
  before insert or update on public.soc_micro_trainings
  for each row
  execute function public.normalize_soc_micro_trainings_uppercase();

-- ============================================================
-- Conversão retroativa — os dados que já existiam
-- ============================================================
-- Só chega até aqui com sucesso se os 188 duplicados de collaborators já
-- tiverem sido mesclados (ver aviso no topo do arquivo). Os UPDATEs abaixo
-- dependem só do trigger de cada tabela — não precisam repetir a lista de
-- colunas, já que gravar o próprio valor de volta aciona o BEFORE UPDATE.

update public.collaborators set name = name;
update public.trainings_completed set training_type = training_type;
update public.trainings set name = name;
update public.training_folders set name = name;
update public.folders set name = name;
update public.materials set name = name;
update public.socs set name = name;
update public.instructors set name = name;
update public.quiz_questions set question = question;
update public.users_profiles set full_name = full_name;
update public.training_schedules set title = title;
update public.training_schedule_enrollments set collaborator_name = collaborator_name;
update public.schedule_audit_log set schedule_title = schedule_title;
update public.training_scheduling_requests set instructor_name = instructor_name;
update public.training_scheduling_request_collaborators set collaborator_name = collaborator_name;
update public.soc_micro_trainings set name = name;

-- Snapshot histórico em trainings_completed: não tem trigger próprio (ver
-- nota acima), então este é o único jeito de corrigir o que já foi
-- gravado antes de hoje.
update public.trainings_completed
set collaborator_name = upper(collaborator_name),
    collaborator_soc   = upper(collaborator_soc)
where collaborator_name is not null or collaborator_soc is not null;

-- Refaz o vínculo de líder — o texto livre `leader` pode ter mudado de
-- caixa nesta conversão, e o casamento com o líder é sensível a isso até
-- este UPDATE rodar.
select public.resolve_leader_links();

-- ── Conferência ──────────────────────────────────────────────
select
  '✅ Normalização para MAIÚSCULO aplicada.' as status,
  (select count(*) from public.collaborators)                     as total_collaborators,
  (
    select count(*) from (
      select upper(name) as n, upper(soc) as s, count(*)
      from public.collaborators
      where name is not null and soc is not null
      group by upper(name), upper(soc)
      having count(*) > 1
    ) dup
  )                                                                as colaboradores_ainda_duplicados_deve_ser_zero,
  (select count(*) from public.collaborators where name <> upper(name)) as nomes_ainda_nao_maiusculos_deve_ser_zero;
