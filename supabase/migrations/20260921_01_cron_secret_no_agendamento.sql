-- ============================================================
-- O agendamento das 05h passa a se identificar por segredo próprio
-- ============================================================
-- ── POR QUE (diagnóstico de 21/09/2026) ─────────────────────
-- Com os segredos project_url/service_role_key finalmente criados na Vault
-- (eram o passo manual que nunca foi feito — ver 20260916_04), o job
-- deixou de falhar antes da chamada... e passou a falhar DENTRO da função,
-- com HTTP 401 {"error":"Sessão inválida."}.
--
-- A causa: a função identificava o cron comparando o Bearer recebido,
-- caractere por caractere, com a própria variável SUPABASE_SERVICE_ROLE_KEY
-- do ambiente dela. A chave gravada na Vault é um JWT válido, service_role,
-- do projeto correto — o gateway aceitou — mas NÃO é idêntica à que a
-- função vê no ambiente. Basta o projeto receber a chave no formato novo
-- (sb_secret_..., que o gateway nem aceita como Bearer) ou uma rotação de
-- chave para os dois lados se desalinharem em silêncio. Resultado: o
-- agendamento falhou todos os dias de 11/08 a 21/09 e a base só era
-- atualizada quando alguém clicava no botão.
--
-- ── O QUE MUDA ──────────────────────────────────────────────
-- O job passa a enviar o header 'x-cron-secret' com o valor do segredo
-- 'cron_secret' da Vault. A função compara esse header com a variável
-- CRON_SECRET do ambiente dela (mesmo valor, definido via
-- `supabase secrets set`). Não depende mais de qual formato de chave a
-- plataforma injeta, não quebra em rotação de chave, e a autorização do
-- cron é decidida dentro da função — não por uma configuração de deploy.
--
-- O Authorization continua indo com a service_role key porque o gateway da
-- função exige um JWT válido (verify_jwt) antes de encaminhar a chamada.
--
-- ⚠️ PRÉ-REQUISITOS (já feitos em 21/09/2026, mas necessários se este
-- arquivo for aplicado num projeto novo):
--   · os três segredos na Vault: project_url, service_role_key, cron_secret;
--   · a variável CRON_SECRET no ambiente da função, com o MESMO valor do
--     segredo cron_secret (`supabase secrets set CRON_SECRET=...`);
--   · a função sync-collaborators publicada na versão que lê o header.
--
-- Horário inalterado: 08:00 UTC = 05:00 em Brasília.
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
    v_url     text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
    v_chave   text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key');
    v_segredo text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
  begin
    if v_url is null or v_chave is null or v_segredo is null then
      raise exception
        'Sincronização automática não disparou: falta o segredo % na Vault. Rode scripts/diagnostico_cron_sync.sql para conferir.',
        concat_ws(' e ',
          case when v_url     is null then '''project_url'''      end,
          case when v_chave   is null then '''service_role_key''' end,
          case when v_segredo is null then '''cron_secret'''      end);
    end if;

    perform net.http_post(
      url                  := v_url || '/functions/v1/sync-collaborators',
      headers              := jsonb_build_object(
                                'Content-Type',   'application/json',
                                -- exigido pelo gateway (verify_jwt)
                                'Authorization',  'Bearer ' || v_chave,
                                -- é ISTO que prova à função que é o cron
                                'x-cron-secret',  v_segredo
                              ),
      body                 := jsonb_build_object('source', 'cron'),
      -- 5 min: a sincronização grava ~21 mil colaboradores e o padrão do
      -- pg_net são 5 segundos (ver 20260916_04).
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
  command ilike '%x-cron-secret%' as envia_o_segredo,
  (select count(*) from vault.decrypted_secrets
    where name in ('project_url', 'service_role_key', 'cron_secret')) as segredos_na_vault_esperado_3
from cron.job
where jobname = 'sync-gsheet-daily-5am';
