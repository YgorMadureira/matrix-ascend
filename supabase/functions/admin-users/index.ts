// Edge Function: admin-users
//
// Substitui o cliente `supabaseAdmin` (service_role) que antes rodava no navegador.
// A service_role key nunca sai deste ambiente servidor — o frontend só chama esta
// função com o token de sessão do usuário logado, e é AQUI que validamos se ele é admin.
//
// Deploy:
//   supabase functions deploy admin-users
//
// Não é necessário configurar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manualmente:
// o Supabase injeta essas variáveis automaticamente em toda Edge Function do projeto.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Action =
  | { action: 'create_user'; email: string; password: string; full_name: string; role: string; soc: string | null }
  | { action: 'delete_user'; id: string }
  | { action: 'reset_password'; id: string; password: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Não autenticado.' }, 401);
    }

    // Cliente "do usuário" — usa a mesma sessão que chamou a função, só para validar identidade/role.
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: 'Sessão inválida.' }, 401);
    }

    // Cliente admin — service_role, só existe dentro da função (nunca chega ao navegador).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: callerProfile, error: profileErr } = await admin
      .from('users_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profileErr || callerProfile?.role?.toLowerCase().trim() !== 'admin') {
      return json({ error: 'Apenas administradores podem gerenciar usuários.' }, 403);
    }

    const body = (await req.json()) as Action;

    switch (body.action) {
      case 'create_user': {
        const { data, error } = await admin.auth.admin.createUser({
          email: body.email.trim().toLowerCase(),
          password: body.password,
          email_confirm: true,
          user_metadata: { full_name: body.full_name, role: body.role, must_change_password: true },
        });
        if (error) return json({ error: error.message }, 400);

        const { error: profileError } = await admin.from('users_profiles').upsert({
          id: data.user!.id,
          email: body.email.trim().toLowerCase(),
          full_name: body.full_name,
          role: body.role,
          soc: body.soc,
        }, { onConflict: 'id' });
        if (profileError) return json({ error: profileError.message, userCreated: true }, 400);

        return json({ id: data.user!.id });
      }

      case 'delete_user': {
        await admin.from('users_profiles').delete().eq('id', body.id);
        const { error } = await admin.auth.admin.deleteUser(body.id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case 'reset_password': {
        if (!body.password || body.password.length < 6) {
          return json({ error: 'A senha deve ter no mínimo 6 caracteres.' }, 400);
        }
        const { error } = await admin.auth.admin.updateUserById(body.id, { password: body.password });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: 'Ação desconhecida.' }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erro inesperado.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
