-- ============================================================
-- Registro das execuções da sincronização com o Google Sheets
-- ============================================================
-- Até aqui não havia como saber se o agendamento das 05h estava mesmo
-- rodando. A tela mostrava "Última manual: ..." lida do localStorage do
-- NAVEGADOR — ou seja, era a última vez que AQUELE navegador clicou no
-- botão. Trocar de máquina zerava a informação, e a execução automática,
-- que é a que interessa validar, não aparecia em lugar nenhum.
--
-- A tabela sync_locks já existia como trava de concorrência. Ela ganha aqui
-- o papel de também registrar a última execução de cada tipo (automática e
-- manual), com o resultado — porque "rodou" e "rodou e deu certo" são
-- coisas diferentes, e o objetivo é justamente confirmar que o acionador
-- funciona.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

alter table public.sync_locks add column if not exists last_auto_run_at    timestamptz;
alter table public.sync_locks add column if not exists last_auto_ok        boolean;
alter table public.sync_locks add column if not exists last_auto_summary   text;
alter table public.sync_locks add column if not exists last_manual_run_at  timestamptz;
alter table public.sync_locks add column if not exists last_manual_ok      boolean;
alter table public.sync_locks add column if not exists last_manual_summary text;

comment on column public.sync_locks.last_auto_run_at is
  'Quando o agendamento das 05h terminou pela última vez. É por este campo que se confirma que o cron está vivo.';
comment on column public.sync_locks.last_auto_summary is
  'Resumo da última execução automática (quantos atualizados/removidos) ou a mensagem de erro, quando falhou.';
comment on column public.sync_locks.last_manual_run_at is
  'Quando alguém rodou pelo botão. Fica no banco, e não no localStorage, para valer em qualquer navegador.';

-- ── Leitura para a tela ──────────────────────────────────────
-- A tabela tinha RLS ligado e NENHUMA política: na prática, ninguém logado
-- conseguia ler nada dela — por isso a tela dependia do localStorage. Como
-- aqui só existem carimbos de data e contagens (nada sensível, nada de
-- outra unidade), a leitura é liberada para qualquer usuário autenticado.
-- A ESCRITA continua sem política: só a service_role, ou seja, só a Edge
-- Function, mexe nestes campos.
drop policy if exists "read_sync_locks" on public.sync_locks;
create policy "read_sync_locks" on public.sync_locks
  for select to authenticated
  using (true);

-- ── Conferência ──────────────────────────────────────────────
-- last_auto_run_at vem nulo agora e só é preenchido na próxima execução do
-- cron (05h). Se continuar nulo depois disso, o acionador não está rodando.
select
  '✅ Registro de execuções pronto.' as status,
  id,
  last_auto_run_at,
  last_manual_run_at,
  locked,
  disabled
from public.sync_locks;
