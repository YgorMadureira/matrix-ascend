-- ============================================================
-- Cadastro de onboarding duplicado pela planilha (06/10/2026)
-- ============================================================
-- ── O PROBLEMA ───────────────────────────────────────────────
-- A pessoa entra pela aba Onboarding com o nome digitado por quem fez o
-- cadastro ("ADRIANA GÓIS DE SOUZA") e assina o onboarding pelo QR — a
-- assinatura fica nesse cadastro. Dias depois a sincronização traz a mesma
-- pessoa da planilha do RH escrita de outro jeito ("ADRIANA GOIS DE SOUZA").
-- O upsert da sincronização casa por (name, soc) EXATO: com o nome igual,
-- ele promove o cadastro de onboarding e as assinaturas vêm junto; com
-- qualquer diferença de acento, pontuação ou espaço, ele cria um SEGUNDO
-- cadastro, no setor certo e sem assinatura nenhuma — que aparece como
-- PENDENTE na aba Ativos, enquanto o cadastro com a assinatura continua
-- CERTIFICADO na aba Onboarding.
--
-- Em 06/10/2026 eram 232 pares assim em 17 unidades (SP35 48, SP8 46,
-- SP2 25, SP24 22, RJ2 19...); 194 pessoas passam a CERTIFICADO ao juntar.
-- Os cadastros de onboarding quase nunca têm matrícula (2 de 2.558), então
-- o nome é o único vínculo possível.
--
-- ── O QUE ESTA MIGRAÇÃO CRIA ────────────────────────────────
--   · chave_nome_pessoa(nome): o nome sem acento, sem pontuação, maiúsculo
--     e com espaços únicos — "KAMILLE CAVALCANTE PEREIRA." e "VINÍCIUS  DE
--     PINHO" viram a mesma chave que a grafia da planilha.
--   · juntar_cadastros(origem, destino): ÚNICA implementação de "juntar":
--     move as assinaturas e as inscrições de agendamento do cadastro de
--     onboarding para o outro e apaga o de onboarding. Usada pela rotina
--     automática abaixo e, manualmente, para os pares revisados à mão (nome
--     encurtado na planilha, erro de digitação), que a chave não pega.
--   · absorver_onboarding_duplicados(p_aplicar): acha os pares pela chave e
--     junta. p_aplicar=false só classifica.
--
-- Criar a migração NÃO junta nada: só cria as funções. Para ver o que vai
-- mudar e depois aplicar:
--   select situacao, count(*), sum(assinaturas)
--   from public.absorver_onboarding_duplicados(false) group by 1;
--   select situacao, count(*), sum(assinaturas)
--   from public.absorver_onboarding_duplicados(true) group by 1;
--
-- ── REGRAS (conservadoras, como em relink_orphan_trainings) ─
--   · só junta dentro da MESMA unidade e só absorve cadastro de ONBOARDING
--     — dois cadastros da planilha nunca são mexidos aqui;
--   · destino = o ÚNICO cadastro da planilha com aquela chave na unidade.
--     Se houver dois, é homônimo ou erro da planilha: 'ambiguo', não junta;
--   · sem cadastro da planilha, mas com o onboarding repetido (ANDRE e
--     ANDRÉ cadastrados duas vezes), o destino é o de onboarding com mais
--     assinaturas (empate: o mais antigo);
--   · trava de matrícula: se os dois têm opsid válido e diferente, é outra
--     pessoa — 'opsid_diverge', não junta;
--   · cadastro marcado como líder nunca é apagado ('lider').
--
-- O cadastro que fica é o da planilha: setor, turno, líder etc. já são os
-- dela e a sincronização reescreve todos a cada execução. Do onboarding só
-- se aproveita o que a planilha não traz: o e-mail (e, quando o destino
-- também é de onboarding, os campos que estiverem vazios nele).
--
-- O snapshot da assinatura (collaborator_name/soc/opsid) passa a ser o do
-- cadastro que fica — o gatilho trg_snapshot_collaborator faz isso ao mudar
-- collaborator_id, o mesmo que já acontece na religação de órfãs.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

create or replace function public.chave_nome_pessoa(p_name text)
returns text
language sql
immutable
as $$
  -- Apóstrofo some ("D'ÁVILA" = "DÁVILA"); qualquer outro sinal vira espaço
  -- ("SILVA-SOUZA" = "SILVA SOUZA", "PEREIRA." = "PEREIRA").
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(public.normalize_person_name(p_name), '[''’`´]', '', 'g'),
      '[^A-Z ]', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

comment on function public.chave_nome_pessoa(text) is
  'Nome sem acento, sem pontuação, maiúsculo e com espaços únicos. Chave usada para achar o mesmo nome escrito de jeitos diferentes (absorver_onboarding_duplicados). Espelho em src/lib/nomes.ts.';

-- ── juntar_cadastros ─────────────────────────────────────────
create or replace function public.juntar_cadastros(p_origem uuid, p_destino uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origem  public.collaborators%rowtype;
  v_destino public.collaborators%rowtype;
  v_movidas integer;
begin
  if p_origem = p_destino then
    raise exception 'Origem e destino são o mesmo cadastro (%).', p_origem;
  end if;

  select * into v_origem from public.collaborators where id = p_origem for update;
  if not found then
    raise exception 'Cadastro de origem % não existe.', p_origem;
  end if;
  select * into v_destino from public.collaborators where id = p_destino for update;
  if not found then
    raise exception 'Cadastro de destino % não existe.', p_destino;
  end if;

  if not coalesce(v_origem.is_onboarding, false) then
    raise exception 'Só um cadastro de onboarding pode ser absorvido — "%" não é.', v_origem.name;
  end if;
  if coalesce(v_origem.is_leader, false) then
    raise exception '"%" está marcado como líder; junte pela tela, não por rotina.', v_origem.name;
  end if;
  if upper(trim(coalesce(v_origem.soc, ''))) <> upper(trim(coalesce(v_destino.soc, ''))) then
    raise exception '"%" (%) e "%" (%) são de unidades diferentes.',
      v_origem.name, v_origem.soc, v_destino.name, v_destino.soc;
  end if;

  update public.trainings_completed
     set collaborator_id = p_destino
   where collaborator_id = p_origem;
  get diagnostics v_movidas = row_count;

  -- Agendamento guarda o id como texto, sem chave estrangeira: sem isto a
  -- inscrição ficaria apontando para um cadastro que não existe mais.
  update public.training_schedule_enrollments
     set collaborator_id = p_destino::text
   where collaborator_id = p_origem::text;
  update public.training_scheduling_request_collaborators
     set collaborator_id = p_destino::text
   where collaborator_id = p_origem::text;

  update public.collaborators
     set leader_id = p_destino
   where leader_id = p_origem;

  update public.collaborators d
     set email = coalesce(nullif(trim(d.email), ''), nullif(trim(v_origem.email), '')),
         -- Os campos abaixo a sincronização reescreve; só valem quando o
         -- destino também é de onboarding (cadastro repetido na aba).
         gender         = case when d.is_onboarding then coalesce(nullif(trim(d.gender), ''), v_origem.gender) else d.gender end,
         admission_date = case when d.is_onboarding then coalesce(d.admission_date, v_origem.admission_date) else d.admission_date end,
         opsid          = case when d.is_onboarding then coalesce(nullif(trim(d.opsid), ''), v_origem.opsid) else d.opsid end,
         role           = case when d.is_onboarding then coalesce(nullif(trim(d.role), ''), v_origem.role) else d.role end,
         bpo            = case when d.is_onboarding then coalesce(nullif(trim(d.bpo), ''), v_origem.bpo) else d.bpo end
   where d.id = p_destino;

  delete from public.collaborators where id = p_origem;

  return v_movidas;
end;
$$;

comment on function public.juntar_cadastros(uuid, uuid) is
  'Junta um cadastro de ONBOARDING (origem) a outro da mesma unidade (destino): move assinaturas e inscrições de agendamento e apaga a origem. Devolve quantas assinaturas moveu. Única implementação — ver 20261006_01.';

revoke all on function public.juntar_cadastros(uuid, uuid) from public, anon, authenticated;
grant execute on function public.juntar_cadastros(uuid, uuid) to service_role;

-- ── absorver_onboarding_duplicados ───────────────────────────
create or replace function public.absorver_onboarding_duplicados(p_aplicar boolean default false)
returns table (
  soc          text,
  origem_id    uuid,
  origem_nome  text,
  destino_id   uuid,
  destino_nome text,
  assinaturas  integer,
  situacao     text
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  r record;
begin
  for r in
    with
    base as (
      select c.id, c.name, c.created_at,
             upper(trim(c.soc))                                              as soc_n,
             coalesce(c.is_onboarding, false)                                as onb,
             coalesce(c.is_leader, false)                                    as lider,
             public.chave_nome_pessoa(c.name)                                as chave,
             nullif(regexp_replace(coalesce(c.opsid, ''), '\D', '', 'g'), '') as op
      from public.collaborators c
      where coalesce(trim(c.soc), '') <> ''
        and coalesce(trim(c.name), '') <> ''
    ),
    grupos as (
      select b.soc_n, b.chave
      from base b
      group by b.soc_n, b.chave
      having count(*) > 1 and bool_or(b.onb)
    ),
    membros as (
      select b.*,
             (select count(*) from public.trainings_completed tc where tc.collaborator_id = b.id)::int as n_ass
      from base b
      join grupos g on g.soc_n = b.soc_n and g.chave = b.chave
    ),
    planilha as (
      select m.soc_n, m.chave, count(*) as n, min(m.id::text)::uuid as id
      from membros m
      where not m.onb
      group by m.soc_n, m.chave
    ),
    destino_onb as (
      select distinct on (m.soc_n, m.chave) m.soc_n, m.chave, m.id
      from membros m
      where m.onb
      order by m.soc_n, m.chave, m.n_ass desc, m.created_at, m.id
    ),
    pares as (
      select m.soc_n, m.id as o_id, m.name as o_nome, m.n_ass, m.op as o_op, m.lider,
             coalesce(p.id, d.id) as d_id, coalesce(p.n, 0) as n_planilha
      from membros m
      left join planilha    p on p.soc_n = m.soc_n and p.chave = m.chave
      left join destino_onb d on d.soc_n = m.soc_n and d.chave = m.chave
      where m.onb
        and m.id <> coalesce(p.id, d.id)
    )
    select pr.soc_n, pr.o_id, pr.o_nome, pr.d_id, dst.name as d_nome, pr.n_ass,
      case
        when pr.n_planilha > 1 then 'ambiguo'
        when pr.lider          then 'lider'
        when pr.o_op is not null and length(pr.o_op) >= 4 and pr.o_op !~ '^0+$'
         and dop.op  is not null and length(dop.op)  >= 4 and dop.op  !~ '^0+$'
         and pr.o_op <> dop.op then 'opsid_diverge'
        else                        'juntavel'
      end as sit
    from pares pr
    join public.collaborators dst on dst.id = pr.d_id
    cross join lateral (
      select nullif(regexp_replace(coalesce(dst.opsid, ''), '\D', '', 'g'), '') as op
    ) dop
    order by pr.soc_n, pr.o_nome
  loop
    soc          := r.soc_n;
    origem_id    := r.o_id;
    origem_nome  := r.o_nome;
    destino_id   := r.d_id;
    destino_nome := r.d_nome;
    assinaturas  := r.n_ass;
    situacao     := r.sit;
    if p_aplicar and r.sit = 'juntavel' then
      perform public.juntar_cadastros(r.o_id, r.d_id);
    end if;
    return next;
  end loop;
end;
$$;

comment on function public.absorver_onboarding_duplicados(boolean) is
  'Junta cadastros de onboarding ao cadastro da planilha da mesma unidade quando o nome só difere por acento, pontuação ou espaço (chave_nome_pessoa). p_aplicar=false só classifica; true junta. Ver 20261006_01.';

revoke all on function public.absorver_onboarding_duplicados(boolean) from public, anon, authenticated;
grant execute on function public.absorver_onboarding_duplicados(boolean) to service_role;
