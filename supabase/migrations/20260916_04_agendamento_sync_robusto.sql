-- ============================================================
-- Agendamento das 05h: tempo limite adequado e erro que se explica
-- ============================================================
-- ── O QUE ESTAVA ACONTECENDO (diagnóstico de 16/09/2026) ────
-- O job "sync-gsheet-daily-5am" existia, estava ativo e disparava todo dia
-- às 05:00 — e falhava todas as vezes com:
--   ERROR: null value in column "url" of relation "http_request_queue"
-- Ele monta a URL da Edge Function lendo o segredo 'project_url' da Vault,
-- e nem esse nem o 'service_role_key' existiam: o passo manual descrito em
-- 20260811_02 nunca foi feito. Sem URL, o pg_net recusa a requisição antes
-- de chamar a função — nada é registrado, e a tela mostrava "AUTO: NUNCA".
-- Desde 11/08 a base só foi atualizada quando alguém clicou em Sincronizar.
--
-- ⚠️ ESTA MIGRAÇÃO NÃO CRIA OS SEGREDOS — de propósito. O valor da
-- service_role key não pode ir para um arquivo versionado no git. Os dois
-- comandos de criação estão na mensagem que acompanhou esta migração; o
-- scripts/diagnostico_cron_sync.sql confirma se deu certo.
--
-- ── O QUE MUDA NO JOB ────────────────────────────────────────
-- 1. TEMPO LIMITE. O job chamava net.http_post sem timeout_milliseconds, e
--    o padrão do pg_net é 5 segundos. A sincronização lê a planilha inteira
--    e grava ~21 mil colaboradores — leva bem mais que isso. O pg_net
--    desistiria de esperar aos 5s; não há garantia de que a função continue
--    rodando depois que a conexão cai, e uma sincronização cortada no meio
--    todo dia é pior do que nenhuma. Agora espera até 5 minutos.
--
-- 2. ERRO QUE SE EXPLICA. Se algum segredo faltar (de novo), o job falha
--    com uma mensagem dizendo exatamente isso e onde conferir, em vez do
--    "null value in column url" — que ninguém associaria à Vault. A
--    mensagem aparece em cron.job_run_details, que o diagnóstico mostra.
--
-- O horário não muda: 08:00 UTC = 05:00 em Brasília (sem horário de verão
-- desde 2019).
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

select cron.unschedule(jobid)
from cron.job
where jobname = 'sync-gsheet-daily-5am';

select cron.schedule(
  'sync-gsheet-daily-5am',
  '0 8 * * *',
  $job$
  do $corpo$
  declare
    v_url   text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
    v_chave text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key');
  begin
    if v_url is null or v_chave is null then
      raise exception
        'Sincronização automática não disparou: falta o segredo % na Vault. Rode scripts/diagnostico_cron_sync.sql para conferir.',
        concat_ws(' e ',
          case when v_url   is null then '''project_url'''      end,
          case when v_chave is null then '''service_role_key''' end);
    end if;

    perform net.http_post(
      url                  := v_url || '/functions/v1/sync-collaborators',
      headers              := jsonb_build_object(
                                'Content-Type',  'application/json',
                                'Authorization', 'Bearer ' || v_chave
                              ),
      body                 := jsonb_build_object('source', 'cron'),
      timeout_milliseconds := 300000
    );
  end
  $corpo$;
  $job$
);

-- ── Conferência ──────────────────────────────────────────────
select
  jobname,
  schedule,
  active,
  (select count(*) from vault.decrypted_secrets
    where name in ('project_url', 'service_role_key')) as segredos_na_vault_esperado_2
from cron.job
where jobname = 'sync-gsheet-daily-5am';
