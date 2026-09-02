-- ============================================================
-- Líder só sai pela plataforma — nunca por sincronização ou script
-- ============================================================
-- Incidente de 02/09/2026: os líderes cadastrados manualmente na aba
-- Líderes foram apagados durante a sincronização com o Google Sheets.
--
-- A causa: a Edge Function sync-collaborators já tinha, no código-fonte, a
-- proteção certa — `!c.is_leader` no filtro de quem pode ser removido (ver
-- supabase/functions/sync-collaborators/index.ts). Mas essa proteção só
-- vale depois de a função ser REIMPLANTADA no Supabase, e o deploy é uma
-- ação manual, fora do meu alcance nesta sessão. A função que estava
-- efetivamente rodando ainda era a versão anterior, cujo único filtro era
-- "o texto do cargo contém LÍDER/GERENTE/...". Como o formulário da aba
-- Líderes não tem campo de Cargo, todo líder cadastrado por ali tinha cargo
-- vazio — não batia com o filtro antigo — e foi apagado como se tivesse
-- saído da planilha. Sobrou 1 (Daniel Ferreira da Silva, BA2), que por
-- coincidência já existia como colaborador comum vindo do ABS com um cargo
-- cujo texto continha "líder", e só por isso escapou.
--
-- A LIÇÃO: proteção que vive só no código da aplicação depende do deploy
-- estar em dia — e este incidente prova que essa suposição falha. A partir
-- daqui, a regra "líder não é removido por processo automático" passa a
-- valer no BANCO, não só no código da Edge Function. Mesmo que uma versão
-- desatualizada da função volte a rodar um dia, ela não vai mais conseguir
-- apagar um líder.
--
-- COMO A TRAVA DISTINGUE "PLATAFORMA" DE "PROCESSO AUTOMÁTICO":
-- auth.uid() só existe quando o pedido chega com a sessão de um usuário
-- logado — é exatamente o caminho da tela (o botão de excluir usa a sessão
-- de quem está logado). A Edge Function de sincronização chama o banco com
-- a service_role key direto, sem sessão de usuário — auth.uid() vem nulo
-- nesse caso. A trava bloqueia quando is_leader é verdadeiro E não há
-- sessão de usuário — ou seja, exatamente "processo automático tentando
-- apagar um líder". Um admin apagando um líder pela tela continua
-- funcionando normalmente.
--
-- Efeito colateral intencional: um script rodando com a service_role key
-- (como os scripts/*.mjs deste projeto) também não vai conseguir apagar um
-- líder direto — precisa primeiro desmarcar is_leader. Isso está certo:
-- "só poderá ser apagado de dentro da plataforma" pedido pelo usuário.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

create or replace function public.guard_leader_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.is_leader and auth.uid() is null then
    raise exception
      'Colaboradores marcados como líder só podem ser excluídos pela plataforma, por um usuário logado — nunca por sincronização ou script. Para remover "%": desmarque a flag de líder primeiro, ou exclua pela tela de Colaboradores.',
      OLD.name
      using errcode = '42501';
  end if;
  return OLD;
end;
$$;

comment on function public.guard_leader_deletion() is
  'Impede que qualquer processo sem sessão de usuário (sync-collaborators, scripts com a service_role key) apague um colaborador marcado como líder. Criada depois do incidente de 02/09/2026, em que a Edge Function de sincronização apagou os líderes cadastrados manualmente.';

drop trigger if exists trg_guard_leader_deletion on public.collaborators;
create trigger trg_guard_leader_deletion
  before delete on public.collaborators
  for each row
  execute function public.guard_leader_deletion();

-- ── Conferência ──────────────────────────────────────────────
select
  '✅ Trava de exclusão de líderes aplicada.' as status,
  (select count(*) from public.collaborators where is_leader) as lideres_hoje;

-- Teste rápido, opcional — mostra que a trava funciona sem apagar nada de
-- verdade (a transação é desfeita no fim). Cole e rode como um bloco à
-- parte, se quiser confirmar antes de confiar na trava — o SQL Editor roda
-- sem sessão de usuário (auth.uid() nulo), o mesmo caminho da
-- sincronização, então o DELETE abaixo DEVE falhar com o erro 42501:
--
-- begin;
--   do $$
--   declare v_id uuid;
--   begin
--     insert into public.collaborators (name, soc, is_leader)
--       values ('TESTE TRAVA DE LIDER', 'SP6', true)
--       returning id into v_id;
--     delete from public.collaborators where id = v_id; -- espera-se ERRO 42501 aqui
--   end $$;
-- rollback;
