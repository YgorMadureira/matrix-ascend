-- ============================================================
-- Perfil MASTER — acesso global, acima de admin
-- ============================================================
-- O que ele é: um admin cujo alcance não para na própria unidade.
-- Enxerga e edita todas as SOCs, e é o único que pode disparar a
-- sincronização com o Google Sheets (que é uma operação global — ela
-- reescreve e remove colaboradores de TODAS as unidades de uma vez).
--
-- O que este arquivo faz:
--   1. Passa a aceitar 'master' como valor de users_profiles.role
--   2. Cria os ajudantes is_master() / current_user_role()
--   3. Instala o gatilho que impede escalada de privilégio
--   4. Promove a conta do Ygor — o primeiro master
--   5. Separa "sync rodando agora" de "sync desligado de propósito"
--
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.
-- ============================================================

-- ── 1. 'master' vira um valor aceito em users_profiles.role ─────
-- A tabela pode ter (ou não) um CHECK listando os perfis válidos —
-- ele foi criado em momentos diferentes do projeto e o nome varia.
-- Este bloco encontra qualquer CHECK que mencione a coluna role,
-- derruba e recria com a lista completa dos seis perfis.
do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.users_profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.users_profiles drop constraint %I', con.conname);
    raise notice 'CHECK antigo removido: %', con.conname;
  end loop;

  alter table public.users_profiles
    add constraint users_profiles_role_check
    check (lower(trim(role)) in ('master','admin','user','lider','bpo','pcp'));
end $$;

comment on column public.users_profiles.role is
  'master = acesso global a todas as SOCs + sync do Sheets; admin = tudo dentro da própria SOC; lider/bpo/pcp/user = acessos parciais.';

-- ── 2. Ajudantes ────────────────────────────────────────────────
-- SECURITY DEFINER para conseguirem ler users_profiles mesmo com RLS
-- ativo — sem isso a política que usa a função consultaria a própria
-- tabela protegida pela política, e entraria em recursão.
create or replace function public.current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select lower(trim(role)) from public.users_profiles where id = auth.uid();
$$;

create or replace function public.current_user_soc()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select soc from public.users_profiles where id = auth.uid();
$$;

create or replace function public.is_master()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select lower(trim(role)) = 'master' from public.users_profiles where id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_master()          to authenticated;
grant execute on function public.current_user_role()  to authenticated;
grant execute on function public.current_user_soc()   to authenticated;

-- ── 3. Gatilho anti-escalada ────────────────────────────────────
-- A regra: SÓ um master concede ou retira o perfil master.
--
-- Por que no banco e não só na tela: a edição de perfil grava direto
-- da aplicação na tabela. Sem esta trava, qualquer admin — de qualquer
-- unidade — se promoveria a master pela API, mesmo com a opção escondida
-- do seletor. Aqui a regra vale para qualquer caminho.
--
-- auth.uid() nulo = a chamada não veio de um usuário logado: é o SQL
-- Editor, uma migração ou a service_role key (usada pela Edge Function
-- admin-users, que faz a sua própria verificação). Quem tem acesso
-- direto ao banco já tem poder total — travar aqui só impediria a
-- promoção inicial abaixo.
create or replace function public.guard_master_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  novo_e_master   boolean := lower(trim(coalesce(new.role, ''))) = 'master';
  antigo_e_master boolean := tg_op = 'UPDATE' and lower(trim(coalesce(old.role, ''))) = 'master';
begin
  if auth.uid() is null then
    return new;
  end if;

  if novo_e_master is distinct from antigo_e_master and not public.is_master() then
    raise exception
      'Somente um usuário master pode conceder ou retirar o perfil master.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_master_role on public.users_profiles;
create trigger trg_guard_master_role
  before insert or update of role on public.users_profiles
  for each row
  execute function public.guard_master_role();

-- ── 4. O primeiro master ────────────────────────────────────────
-- Daqui para frente, todo novo master nasce de outro master (pela tela
-- de Configurações) ou de um UPDATE direto aqui no SQL Editor.
do $$
declare
  afetados int;
begin
  update public.users_profiles
     set role = 'master'
   where upper(trim(full_name)) = 'YGOR MADUREIRA';

  get diagnostics afetados = row_count;

  if afetados = 0 then
    raise warning
      'Nenhum perfil com full_name = "YGOR MADUREIRA" foi encontrado. Promova pelo e-mail: update public.users_profiles set role = ''master'' where email = ''SEU_EMAIL_AQUI'';';
  else
    raise notice 'Perfis promovidos a master: %', afetados;
  end if;
end $$;

-- ── 5. Trava do sync: desligado ≠ rodando agora ─────────────────
-- Até aqui a mesma coluna `locked` significava duas coisas: "tem um
-- sync em andamento" (que expira sozinho em 20 min, para o caso de a
-- função morrer no meio) e "eu bloqueei isto de propósito". As duas só
-- não se confundiam porque a trava de emergência de 11/08 ficou com
-- locked_at nulo — frágil demais para uma proteção criada por causa de
-- um incidente. Agora são coisas separadas: `disabled` não expira.
alter table public.sync_locks
  add column if not exists disabled     boolean not null default false,
  add column if not exists disabled_reason text;

comment on column public.sync_locks.disabled is
  'Bloqueio deliberado e sem prazo. Nenhum timeout solta — só um UPDATE explícito. Diferente de locked, que é a trava de concorrência de um sync em andamento.';

-- Migra a trava de emergência de 11/08 para o novo campo e libera a
-- trava de concorrência (que nunca deveria ter ficado presa).
update public.sync_locks
   set disabled = true,
       disabled_reason = 'Travado apos o incidente de 11/08. Libere so depois de rodar 20260811_03 e testar o sync uma vez.',
       locked = false,
       locked_at = null
 where id = 'gsheet_collaborators'
   and locked = true;

select
  '✅ Perfil master criado.' as status,
  (select count(*) from public.users_profiles where lower(trim(role)) = 'master') as masters,
  (select disabled from public.sync_locks where id = 'gsheet_collaborators') as sync_desligado;
