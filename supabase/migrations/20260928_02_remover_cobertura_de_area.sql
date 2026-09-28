-- ============================================================
-- A regra da tela ganha a segunda mão: também REMOVER cobertura
-- ============================================================
-- ⚠️ A REGRA MORA EM src/lib/trainingRules.ts. Este arquivo é o espelho.
--
-- Até aqui training_area_rules só sabia ADICIONAR cobertura ("este
-- treinamento também credencia esta área"). Pedido de 28/09/2026: tirar uma
-- cobertura EMBUTIDA no motor (ex.: "Onboarding PTS V3" deixar de cobrir
-- Expedição) sem precisar editar trainingRules.ts e publicar.
--
-- ⚠️ É RETROATIVO — mesma natureza que ADICIONA sempre teve, testado e
-- confirmado com o usuário antes desta migração. Uma assinatura é só um
-- texto e uma data; o cálculo de "treinado?" sempre aplica a regra ATUAL
-- sobre TODO o histórico da pessoa. Remover uma cobertura muda o status de
-- quem já assinou no passado, na hora — não só de quem assinar depois.
-- Medido em 28/09/2026: tirar Expedição do PTS V3 afetaria 741 pessoas em
-- 18 unidades, na hora. A tela (SettingsPage.tsx) avisa e mede o efeito
-- antes de você confirmar uma regra do tipo REMOVE.
--
-- ── POR QUE training_unlocks_area / training_credentials_area /
--    training_matches_collaborator DEIXAM DE SER IMMUTABLE ────
-- Até aqui essas três funções eram só comparação de texto — IMMUTABLE era
-- correto porque o resultado dependia só dos argumentos. A partir de agora
-- training_unlocks_area consulta training_area_rules por dentro (ver
-- training_area_override abaixo), então o resultado pode mudar entre uma
-- chamada e outra sem os argumentos mudarem — dizer que é IMMUTABLE seria
-- mentir para o planejador do Postgres. STABLE é o correto: mesmo resultado
-- dentro de uma consulta, pode mudar entre consultas.
--
-- ── POR QUE A SIMPLIFICAÇÃO DA VIEW ────────────────────────
-- A 20260925_01 aplicava a configuração por FORA, com um JOIN em
-- training_area_rules e um "OR r.id IS NOT NULL" solto na view. Isso
-- resolvia ADICIONA (uma regra a mais nunca conflita), mas não dava para
-- estender para REMOVE: o "OR" não sabe SUBTRAIR a contribuição de uma área
-- específica sem decompor o que training_credentials_area já teria
-- decidido por dentro (ela mistura área do grupo, área do setor cadastrado
-- e a exceção do Sorter num boolean só). A configuração agora entra DENTRO
-- de training_unlocks_area, então as views voltam a ser só
-- `bool_or(training_credentials_area(...))`, sem o join extra.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

-- ── 1. training_area_rules ganha o tipo ──────────────────────
alter table public.training_area_rules
  add column if not exists tipo text not null default 'ADICIONA';

alter table public.training_area_rules
  drop constraint if exists training_area_rules_tipo_valido;
alter table public.training_area_rules
  add constraint training_area_rules_tipo_valido check (tipo in ('ADICIONA', 'REMOVE'));

comment on column public.training_area_rules.tipo is
  'ADICIONA: o treinamento passa a credenciar a área (aditivo). REMOVE: o treinamento deixa de credenciar a área, mesmo que a regra embutida credencie — override explícito. O índice único (training_name, area) garante que uma dupla não tenha as duas ao mesmo tempo.';

-- tipo também precisa vir maiúsculo — o trigger de 20260916_02_02 (a função
-- de normalização desta tabela) ganha a linha.
create or replace function public.normalize_training_area_rules_uppercase()
returns trigger
language plpgsql
as $$
begin
  NEW.training_name := upper(btrim(NEW.training_name));
  NEW.area          := upper(btrim(NEW.area));
  NEW.tipo          := upper(btrim(coalesce(NEW.tipo, 'ADICIONA')));
  return NEW;
end;
$$;

-- ── 2. A configuração de uma dupla (training, area) ──────────
-- true = ADICIONA, false = REMOVE, null = sem override (usa a regra embutida).
create or replace function public.training_area_override(
  p_training_type text,
  p_area          text
)
returns boolean
language sql
stable
as $$
  select case r.tipo when 'REMOVE' then false when 'ADICIONA' then true end
  from public.training_area_rules r
  where r.training_name = upper(btrim(p_training_type))
    and r.area = upper(btrim(p_area))
  limit 1;
$$;

comment on function public.training_area_override(text, text) is
  'Override configurado na tela para esta dupla (treinamento, área): true = adiciona, false = remove, null = nenhum, usa a regra embutida. STABLE, não IMMUTABLE — lê training_area_rules.';

grant execute on function public.training_area_override(text, text) to authenticated;

-- ── 3. A regra embutida, isolada da configuração ─────────────
-- Continua IMMUTABLE de propósito: é só texto, não lê tabela nenhuma. Existe
-- separada para scripts/verificar_espelho.ts poder comparar TypeScript ×
-- banco SEM nenhuma regra configurada no meio — é o que prova que a regra
-- embutida em si (não a configuração) continua igual dos dois lados. Sem
-- esta separação, qualquer regra configurada (ex.: a do RJ2) apareceria
-- como "divergência" na Parte 1 daquele script, mascarando uma divergência
-- de verdade se um dia acontecer.
create or replace function public.training_unlocks_area_embutida(
  training_type text,
  area          text,
  has_sorting   boolean
)
returns boolean
language sql
immutable
as $$
  select case
    when public.strip_training_code(training_type) ilike '%onboarding%'
     and public.strip_training_code(training_type) ilike '%pts%' then
      area in ('RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO')
      or (area = 'ASM' and training_type ilike '%com sorter%')
      or (
        area = 'ASM'
        and coalesce(has_sorting, false)
        and training_type ilike '%novos colaboradores%'
      )
    when training_type ilike '%onboarding%' then false
    when training_type ilike '%padr%o soc%' then
      (area = 'RECEBIMENTO'   and training_type ilike '%recebimento%')
      or (area = 'PROCESSAMENTO' and training_type ilike '%processamento%')
      or (area = 'EXPEDIÇÃO'     and training_type ilike '%expedi%')
      or (area = 'TRATATIVAS'    and training_type ilike '%tratativa%')
      or (area = 'ASM'           and training_type ilike '%asm%')
    else false
  end;
$$;

comment on function public.training_unlocks_area_embutida(text, text, boolean) is
  'Espelha areasUnlockedBy() de src/lib/trainingRules.ts — só a regra embutida no motor, sem nenhuma configuração da tela. IMMUTABLE de verdade: não lê tabela. Usada por training_unlocks_area (que soma a configuração) e diretamente por scripts/verificar_espelho.ts para comparar a regra embutida isolada.';

grant execute on function public.training_unlocks_area_embutida(text, text, boolean) to authenticated;

-- ── 3b. training_unlocks_area = embutida + override da tela ──
create or replace function public.training_unlocks_area(
  training_type text,
  area          text,
  has_sorting   boolean
)
returns boolean
language sql
stable
as $$
  select coalesce(
    public.training_area_override(training_type, area),
    public.training_unlocks_area_embutida(training_type, area, has_sorting)
  );
$$;

comment on function public.training_unlocks_area(text, text, boolean) is
  'training_unlocks_area_embutida() + o override configurado na tela (training_area_override) por cima. STABLE desde 28/09/2026 — deixou de ser IMMUTABLE porque agora lê uma tabela. É esta que training_credentials_area usa; para comparar só a regra embutida, use training_unlocks_area_embutida.';

grant execute on function public.training_unlocks_area(text, text, boolean) to authenticated;

-- ── 4. training_credentials_area: STABLE, mesma lógica ───────
-- Corpo idêntico ao de 20260916_03 — só a volatilidade muda, porque agora
-- chama uma função STABLE por dentro.
create or replace function public.training_credentials_area(
  p_training_type text,
  p_area_grupo    text,
  p_area_setor    text,
  p_is_leader     boolean,
  p_has_sorting   boolean
)
returns boolean
language sql
stable
as $$
  select case
    when p_is_leader and p_training_type ilike '%onboarding l%deres%' then true
    when p_area_grupo is not null then
      public.training_unlocks_area(p_training_type, p_area_grupo, p_has_sorting)
      or coalesce(public.training_unlocks_area(p_training_type, p_area_setor, p_has_sorting), false)
      or (p_area_grupo = 'PROCESSAMENTO' and public.training_unlocks_area(p_training_type, 'ASM', p_has_sorting))
    else
      public.training_unlocks_area(p_training_type, 'RECEBIMENTO', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'PROCESSAMENTO', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'EXPEDIÇÃO', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'TRATATIVAS', p_has_sorting)
      or public.training_unlocks_area(p_training_type, 'ASM', p_has_sorting)
  end;
$$;

comment on function public.training_credentials_area(text, text, text, boolean, boolean) is
  'Parte "por assinatura" de isCollaboratorTrained() (src/lib/trainingRules.ts). STABLE desde 28/09/2026 (ver training_unlocks_area).';

grant execute on function public.training_credentials_area(text, text, text, boolean, boolean) to authenticated;

-- ── 5. training_matches_collaborator: STABLE, mesma lógica ───
create or replace function public.training_matches_collaborator(
  p_training_type text,
  p_sector        text,
  p_activity      text,
  p_is_leader     boolean,
  p_has_sorting   boolean
)
returns boolean
language sql
stable
as $$
  select public.training_credentials_area(
    p_training_type,
    public.collaborator_group_area(p_sector, p_has_sorting, p_activity),
    public.collaborator_macro_area(p_sector),
    p_is_leader,
    p_has_sorting
  );
$$;

comment on function public.training_matches_collaborator(text, text, text, boolean, boolean) is
  'Espelha isCollaboratorTrained() de src/lib/trainingRules.ts. STABLE desde 28/09/2026 (ver training_unlocks_area). Para uso avulso — as views usam collaborator_group_area + training_credentials_area diretamente.';

grant execute on function public.training_matches_collaborator(text, text, text, boolean, boolean) to authenticated;

-- ── 6. Views: o override já vem de dentro — tira o JOIN extra ─
-- Mesmas colunas de 20260814_01, na mesma ordem.
create or replace view public.collaborators_status
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.opsid,
  c.gender,
  c.soc,
  c.sector,
  c.shift,
  c.leader,
  c.role,
  c.bpo,
  c.is_onboarding,
  c.admission_date,
  c.activity,
  coalesce(t.is_trained, false)                as is_trained,
  coalesce(t.onboarding_modules, '{}'::text[]) as onboarding_modules,
  c.email,
  c.is_leader,
  c.leader_id
from public.collaborators c
left join public.socs s on s.name = c.soc
cross join lateral (
  select
    public.collaborator_group_area(c.sector, coalesce(s.has_sorting, false), c.activity) as area_grupo,
    public.collaborator_macro_area(c.sector)                                             as area_setor,
    coalesce(s.has_sorting, false)                                                       as has_sorting
  offset 0
) a
left join lateral (
  select
    bool_or(
      public.training_credentials_area(tc.training_type, a.area_grupo, a.area_setor, c.is_leader, a.has_sorting)
    ) as is_trained,
    array_agg(upper(tc.training_type))
      filter (where tc.training_type ilike '%onboarding%') as onboarding_modules
  from public.trainings_completed tc
  where tc.collaborator_id = c.id
) t on true;

grant select on public.collaborators_status to authenticated;

create or replace view public.soc_performance_view as
select
  c.soc,
  count(*)::int                                   as total_hc,
  count(*) filter (where t.is_trained)::int       as trained_hc,
  case when count(*) > 0
    then round((count(*) filter (where t.is_trained))::numeric / count(*) * 100, 1)
    else 0
  end                                             as pct
from public.collaborators c
join public.socs s on s.name = c.soc
cross join lateral (
  select
    public.collaborator_group_area(c.sector, coalesce(s.has_sorting, false), c.activity) as area_grupo,
    public.collaborator_macro_area(c.sector)                                             as area_setor,
    coalesce(s.has_sorting, false)                                                       as has_sorting
  offset 0
) a
left join lateral (
  select bool_or(
    public.training_credentials_area(tc.training_type, a.area_grupo, a.area_setor, c.is_leader, a.has_sorting)
  ) as is_trained
  from public.trainings_completed tc
  where tc.collaborator_id = c.id
) t on true
where c.soc is not null and c.soc <> ''
group by c.soc;

grant select on public.soc_performance_view to authenticated;

-- ── Conferência ──────────────────────────────────────────────
-- Só leitura — não grava nenhuma regra REMOVE de teste. Números de contexto
-- para acompanhar; a validação de verdade (que a reescrita não mudou
-- NENHUM veredito pessoa por pessoa) é rodar depois, fora do SQL Editor:
--
--   npx vite-node scripts/verificar_espelho.ts
--
-- Esse script já carrega training_area_rules e compara TypeScript × banco
-- para todo mundo — é o jeito certo de provar que reescrever
-- training_unlocks_area/training_credentials_area/training_matches_collaborator
-- preservou o comportamento, muito mais confiável do que qualquer contagem
-- isolada aqui dentro.
select
  '✅ Regra REMOVE disponível. Rode npx vite-node scripts/verificar_espelho.ts para validar.' as status,
  (select count(*) from public.collaborators_status where soc = 'RJ2' and is_trained) as rj2_certificados_hoje,
  (select count(*) from public.training_area_rules)                                   as regras_cadastradas,
  public.count_pending_signers('ONBOARDING PTS V3')                                   as pendentes_pts_v3_hoje;
