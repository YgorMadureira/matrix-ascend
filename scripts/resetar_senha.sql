-- ============================================================
-- Resetar senha de um usuário direto no banco (SQL Editor)
-- ============================================================
-- Mesma ação que scripts/resetar_senha.mjs faz pela Admin API do Supabase
-- Auth, só que em SQL puro — cole no SQL Editor do Supabase e rode.
--
-- Existia um script assim em supabase/migrations/legacy/reset_password.sql,
-- mas ele REMOVIA a flag must_change_password em vez de marcar — ou seja,
-- resetar a senha por ali tinha o mesmo bug que a plataforma tinha (ver
-- correção em supabase/functions/admin-users/index.ts, 14/08/2026): a
-- pessoa entrava com a senha nova sem ser obrigada a trocá-la. Este script
-- corrige isso — por padrão MARCA a conta para exigir troca no próximo
-- login. Se não quiser forçar a troca desta vez, mude v_forcar_troca para
-- false antes de rodar.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  -- ✏️ EDITE AQUI antes de rodar:
  v_email        text    := 'fulano@shopee.com';   -- e-mail do usuário
  v_new_pass     text    := 'SenhaProvisoria123';  -- nova senha (mínimo 6 caracteres)
  v_forcar_troca boolean := true;                  -- exige trocar a senha no próximo login?

  v_user_id uuid;
begin
  if length(v_new_pass) < 6 then
    raise exception '❌ A senha precisa ter no mínimo 6 caracteres.';
  end if;

  select id into v_user_id from auth.users where email = v_email;
  if v_user_id is null then
    raise exception '❌ Usuário com e-mail "%" não foi encontrado em auth.users.', v_email;
  end if;

  update auth.users
  set
    encrypted_password = extensions.crypt(v_new_pass, extensions.gen_salt('bf', 10)),
    updated_at         = now(),
    raw_app_meta_data  = coalesce(raw_app_meta_data, '{}'::jsonb)
                           || '{"provider": "email", "providers": ["email"]}'::jsonb,
    -- Faz merge (||) em vez de apagar a chave: preserva full_name/role que
    -- porventura estejam gravados em raw_user_meta_data.
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                           || jsonb_build_object('must_change_password', v_forcar_troca)
  where id = v_user_id;

  raise notice '✅ Senha de "%" atualizada.', v_email;
  raise notice '   Forçar troca no próximo login: %', v_forcar_troca;
end $$;

-- Conferência: mostra o estado atual da conta depois do reset.
select email, updated_at, raw_user_meta_data->'must_change_password' as forca_troca
from auth.users
where email = 'fulano@shopee.com'; -- ✏️ repita o mesmo e-mail aqui
