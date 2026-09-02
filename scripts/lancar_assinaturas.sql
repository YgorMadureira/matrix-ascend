-- ============================================================
-- Lançar assinaturas de treinamento direto pelo banco (em massa)
-- ============================================================
-- Registra que uma leva de colaboradores concluiu o MESMO treinamento, na
-- MESMA SOC, com o MESMO instrutor, sem passar pela tela nem pelo
-- scripts/importar_assinaturas.mjs — útil para lançar rápido uma sessão de
-- treinamento direto no SQL Editor.
--
-- ⚠️ O PONTO CRÍTICO É O NOME DO TREINAMENTO.
-- O Dashboard e os Relatórios não olham para "existe uma assinatura": eles
-- casam o NOME do treinamento com as regras (Onboarding PTS, Treinamento
-- Padrão SOC - <Área>, ou o nome de um processo micro cadastrado na
-- unidade). Um nome fora do padrão entra no banco, aparece na tela de
-- Assinaturas e não acende nenhum card do Dashboard — o pior tipo de erro,
-- porque parece que funcionou. O BLOCO 5, no fim deste arquivo, avisa se
-- o nome não é reconhecido — não impede a gravação, mas confira antes de
-- fechar a tela.
--
-- COMO USAR:
--   1. Edite o BLOCO 1 — SOC, treinamento, instrutor e data (uma vez só).
--   2. Edite o BLOCO 2 — um nome de colaborador por linha (como está
--      cadastrado; tolera acento e maiúscula/minúscula, não tolera nome
--      digitado diferente).
--   3. Selecione o arquivo INTEIRO e rode de uma vez — os blocos dependem
--      uns dos outros na mesma sessão do SQL Editor.
--   4. Confira os BLOCOS 4, 5 e 6: quem não foi encontrado, quem já tinha
--      esse treinamento (não duplicado) e se o nome do treinamento é
--      reconhecido.
-- ============================================================

-- ── BLOCO 1 — EDITE AQUI: o que é igual para toda a leva ─────
do $$
begin
  -- Guardado numa tabela (não em variáveis de sessão) para os blocos
  -- seguintes, que são consultas soltas, poderem ler os mesmos valores.
  drop table if exists _leva;
  create temporary table _leva as select
    'SP6'                                          as soc,
    '02. Treinamento Padrão SOC - Processamento'   as treinamento,
    'NOME DO INSTRUTOR'                            as instrutor,
    null::date                                     as data; -- null = hoje

  if (select instrutor from _leva) = 'NOME DO INSTRUTOR' then
    raise exception '❌ Edite o BLOCO 1 (SOC/treinamento/instrutor) antes de rodar.';
  end if;
end $$;

-- ── BLOCO 2 — EDITE AQUI: um nome por linha ───────────────────
drop table if exists _nomes;
create temporary table _nomes as
select * from (values
  ('FULANO DA SILVA'),
  ('CICLANA DE SOUZA'),
  ('BELTRANO DE OLIVEIRA')
) as t(nome);

do $$
begin
  if exists (select 1 from _nomes where nome ilike '%FULANO DA SILVA%') then
    raise exception '❌ Edite o BLOCO 2 (lista de nomes) antes de rodar — o exemplo ainda está aí.';
  end if;
end $$;

-- ── BLOCO 3 — resolve cada nome contra o cadastro real ────────
-- Casa por nome (tolerante a acento/caixa, via normalize_person_name — a
-- mesma função usada para ligar líder e time) na SOC definida no BLOCO 1
-- (tolerante a "SP06" vs "SP6"). left join de propósito: quem não bate
-- continua na tabela, com collaborator_id nulo, para aparecer no BLOCO 4.
--
-- ja_existia é calculado AQUI, antes de qualquer gravação — se fosse
-- checado depois do INSERT, todo mundo que acabou de ser inserido também
-- apareceria como "já existia", porque a própria linha nova já contaria.
drop table if exists _resolvido;
create temporary table _resolvido as
select
  n.nome,
  l.soc, l.treinamento, l.instrutor, coalesce(l.data, current_date) as data,
  c.id   as collaborator_id,
  c.name as collaborator_name,
  c.soc  as collaborator_soc,
  c.opsid as collaborator_opsid,
  exists (
    select 1 from public.trainings_completed tc
    where tc.collaborator_id = c.id
      and upper(trim(tc.training_type)) = upper(trim(l.treinamento))
  ) as ja_existia
from _nomes n
cross join _leva l
left join public.collaborators c
  on public.normalize_person_name(c.name) = public.normalize_person_name(n.nome)
 and upper(trim(c.soc)) = upper(trim(regexp_replace(l.soc, '^([A-Za-z]+)0([0-9]+)$', '\1\2')));

-- ── A GRAVAÇÃO ────────────────────────────────────────────────
-- Só grava quem foi encontrado no cadastro e ainda não tinha esse EXATO
-- texto de treinamento registrado. Esse dedup não pega variação de versão
-- no nome ("V3" vs "V.11", por exemplo) — se a leva puder ter esse tipo de
-- variação, use scripts/importar_assinaturas.mjs, que já trata isso.
insert into public.trainings_completed
  (collaborator_id, collaborator_name, collaborator_soc, collaborator_opsid,
   training_type, instructor_name, completed_at, signature_pdf_url)
select
  r.collaborator_id, r.collaborator_name, r.collaborator_soc, r.collaborator_opsid,
  r.treinamento, r.instrutor,
  r.data::timestamptz + interval '12 hours', -- meio-dia: sem hora definida, evita ambiguidade de fuso na exibição
  null
from _resolvido r
where r.collaborator_id is not null
  and not r.ja_existia;

-- ── BLOCO 4 — quem NÃO foi encontrado no cadastro ─────────────
-- Linha aqui = nome não bateu com ninguém na SOC do BLOCO 1. Confira
-- grafia (nome completo, como está no cadastro) e se a pessoa é mesmo
-- dessa unidade.
select nome as "nome digitado"
from _resolvido
where collaborator_id is null;

-- ── BLOCO 5 — quem já tinha esse treinamento (não duplicado) ──
-- Não é erro — é a proteção contra lançar a mesma assinatura duas vezes.
select collaborator_name as "colaborador"
from _resolvido
where collaborator_id is not null
  and ja_existia;

-- ── BLOCO 6 — o nome do treinamento é reconhecido? ────────────
-- Mesma checagem que scripts/importar_assinaturas.mjs faz antes de gravar.
-- "NÃO reconhecido" não impede nada aqui (a gravação já aconteceu) — é um
-- alerta para você corrigir o nome no BLOCO 1 e rodar de novo, porque do
-- jeito que está a assinatura não acende nenhum card.
select
  treinamento,
  case
    when treinamento ilike '%onboarding%' then '✓ reconhecido (Onboarding)'
    when treinamento ilike '%padr%o soc%' then '✓ reconhecido (Treinamento Padrão SOC)'
    when exists (select 1 from public.trainings t where upper(trim(t.name)) = upper(trim(treinamento)))
      then '✓ reconhecido (catálogo de Capacitação EAD)'
    when exists (select 1 from public.soc_micro_trainings m where upper(trim(m.name)) = upper(trim(treinamento)))
      then '✓ reconhecido (processo micro cadastrado em alguma unidade)'
    else '⚠ NÃO reconhecido — não vai acender nenhum card do Dashboard/Relatórios'
  end as status
from _leva;

-- ── Resumo final ───────────────────────────────────────────────
select
  '✅ Lançamento concluído.' as status,
  (select soc from _leva)         as soc,
  (select treinamento from _leva) as treinamento,
  count(*) filter (where collaborator_id is not null and not ja_existia) as "gravadas agora",
  count(*) filter (where collaborator_id is not null and ja_existia)     as "já existiam (ver BLOCO 5)",
  count(*) filter (where collaborator_id is null)                       as "não encontradas (ver BLOCO 4)"
from _resolvido;
