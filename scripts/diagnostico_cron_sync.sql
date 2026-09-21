-- ============================================================
-- Diagnóstico: por que a sincronização das 05h não roda sozinha?
-- ============================================================
-- COMO USAR (SQL Editor do Supabase):
--   1. Cole este arquivo inteiro e clique em Run.
--   2. Espere uns 5 segundos e clique em Run DE NOVO.
--   3. Mande o print do resultado da SEGUNDA execução.
--
-- Por que rodar duas vezes: o item 8 dispara uma requisição de teste que
-- é assíncrona — a resposta dela só aparece na execução seguinte.
--
-- É SEGURO:
--   · não altera nenhuma tabela, não agenda nem desagenda nada;
--   · NÃO dispara a sincronização — o teste do item 8 só lê a linha de
--     sync_locks pela API, usando a mesma chave que o agendamento usa;
--   · não mostra o valor da chave de serviço — só o formato, o tamanho e
--     os campos públicos de dentro dela (papel e projeto).
--
-- Se der erro dizendo que "cron", "vault" ou "net" não existe, essa já é a
-- resposta: a extensão correspondente não está habilitada no projeto.
-- ============================================================

with
job as (
  select jobid, jobname, schedule, active, command
  from cron.job
),
execucoes as (
  select status, return_message, start_time
  from cron.job_run_details
  order by start_time desc
  limit 5
),
segredo_url as (
  select decrypted_secret as v from vault.decrypted_secrets where name = 'project_url'
),
segredo_chave as (
  select decrypted_secret as v from vault.decrypted_secrets where name = 'service_role_key'
),
-- Conteúdo da chave (é um JWT: cabeçalho.conteúdo.assinatura). O conteúdo
-- do meio não é segredo — diz só qual papel e qual projeto a chave serve.
conteudo_chave as (
  select convert_from(
           decode(
             rpad(translate(split_part(v, '.', 2), '-_', '+/'),
                  ((length(split_part(v, '.', 2)) + 3) / 4) * 4, '='),
             'base64'),
           'UTF8')::jsonb as j
  from segredo_chave
  where v like 'eyJ%'
),
-- Teste real da chave: um GET inofensivo pela API, com a mesma chave e a
-- mesma URL que o agendamento usa. Só dispara se os dois segredos existem.
teste as (
  select net.http_get(
    url     := u.v || '/rest/v1/sync_locks?select=id',
    headers := jsonb_build_object('apikey', k.v, 'Authorization', 'Bearer ' || k.v)
  ) as request_id
  from segredo_url u, segredo_chave k
)

select '1. job agendado' as verificacao,
       coalesce(
         (select string_agg(jobname || ' | horário ' || schedule || ' | ativo=' || active, ' ;; ') from job),
         '❌ NENHUM JOB AGENDADO'
       ) as resultado
union all
select '2. o que o job executa',
       coalesce(
         (select string_agg(left(regexp_replace(command, '\s+', ' ', 'g'), 400), ' ;; ') from job),
         '-'
       )
union all
select '3. últimas execuções do job (horário de Brasília)',
       coalesce(
         (select string_agg(
                   to_char(start_time at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ' → ' || status
                   || coalesce(' (' || left(return_message, 150) || ')', ''),
                   ' ;; ' order by start_time desc)
            from execucoes),
         '❌ O JOB NUNCA EXECUTOU'
       )
union all
select '4. segredo project_url',
       coalesce((select v from segredo_url), '❌ NÃO EXISTE NA VAULT')
union all
select '5. segredo service_role_key',
       coalesce(
         (select case
                   when v like 'eyJ%'        then 'existe — formato JWT, ' || length(v) || ' caracteres'
                   when v like 'sb_secret_%' then '❌ existe, mas é chave NOVA (sb_secret_) — o gateway da função rejeita'
                   else '❌ existe, mas formato desconhecido (' || length(v) || ' caracteres)'
                 end
            from segredo_chave),
         '❌ NÃO EXISTE NA VAULT'
       )
union all
-- Desde 21/09/2026 é ESTE segredo que identifica o cron para a função (o
-- header x-cron-secret). Tem de existir aqui E como variável CRON_SECRET no
-- ambiente da função, com o mesmo valor — ver 20260921_01.
select '5b. segredo cron_secret',
       coalesce(
         (select 'existe — ' || length(decrypted_secret) || ' caracteres'
            from vault.decrypted_secrets where name = 'cron_secret'),
         '❌ NÃO EXISTE NA VAULT — o agendamento vai falhar'
       )
union all
select '6. chave serve para (papel / projeto)',
       coalesce(
         (select coalesce(j ->> 'role', '?') || ' / ' || coalesce(j ->> 'ref', '?')
                 || case when j ->> 'role' = 'service_role' and j ->> 'ref' = 'fezfsekzxtvozyemlncn'
                         then '  ✅' else '  ❌ esperado: service_role / fezfsekzxtvozyemlncn' end
            from conteudo_chave),
         '-'
       )
union all
select '7. respostas HTTP recentes (inclui o teste da execução anterior)',
       coalesce(
         (select string_agg(
                   to_char(created at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI:SS')
                   || ' → HTTP ' || coalesce(status_code::text, '-')
                   || ' ' || coalesce(left(content, 120), '')
                   || coalesce(' ERRO: ' || error_msg, ''),
                   ' ;; ' order by created desc)
            from (select * from net._http_response order by created desc limit 5) r),
         'nenhuma resposta registrada'
       )
union all
select '8. teste da chave disparado agora',
       coalesce(
         (select 'sim (requisição ' || request_id || ') — rode de novo em 5s e veja o item 7' from teste),
         'não — falta segredo na Vault (ver itens 4 e 5)'
       );
