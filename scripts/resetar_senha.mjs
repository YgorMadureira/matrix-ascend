// Reseta a senha de um usuário diretamente pelo Supabase Auth (Admin API),
// sem passar pela plataforma.
//
// Uso:
//   node scripts/resetar_senha.mjs fulano@shopee.com
//   node scripts/resetar_senha.mjs fulano@shopee.com --senha "NovaSenha123"
//   node scripts/resetar_senha.mjs --nome "Fulano de Tal"
//
// Por padrão gera uma senha provisória aleatória e marca a conta para
// exigir troca no próximo login (user_metadata.must_change_password = true)
// — o mesmo mecanismo que a plataforma usa ao criar um usuário novo, e que
// o reset pela tela (Configurações → editar usuário) passou a usar depois
// da correção em supabase/functions/admin-users/index.ts.
//
// Opções:
//   --senha "..."        usa esta senha em vez de gerar uma aleatória (mínimo 6 caracteres)
//   --sem-forcar-troca    não marca must_change_password — a pessoa pode manter a senha nova

import { db } from './_conexao.mjs';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opcao = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const alvo = args.find(a => !a.startsWith('--') && a !== opcao('--senha') && a !== opcao('--nome'));

const SENHA = opcao('--senha');
const FORCAR_TROCA = !args.includes('--sem-forcar-troca');
const NOME = opcao('--nome');
const EMAIL = NOME ? null : (alvo || opcao('--email'));

if (!EMAIL && !NOME) {
  console.error('Informe o e-mail:  node scripts/resetar_senha.mjs fulano@shopee.com');
  console.error('ou o nome:         node scripts/resetar_senha.mjs --nome "Fulano de Tal"');
  process.exit(1);
}

// ── 1. Achar o usuário em users_profiles ─────────────────────
let query = db.from('users_profiles').select('id, email, full_name, role');
query = EMAIL ? query.ilike('email', EMAIL.trim()) : query.ilike('full_name', `%${NOME.trim()}%`);
const { data: candidatos, error } = await query;
if (error) { console.error('Erro ao buscar usuário:', error.message); process.exit(1); }

if (!candidatos || candidatos.length === 0) {
  console.error(`Nenhum usuário encontrado com esse ${EMAIL ? 'e-mail' : 'nome'}.`);
  process.exit(1);
}
if (candidatos.length > 1) {
  console.error(`${candidatos.length} usuários encontrados — seja mais específico:`);
  for (const c of candidatos) console.error(`   ${c.full_name} <${c.email}> (${c.role})`);
  process.exit(1);
}
const usuario = candidatos[0];

// ── 2. Gerar ou validar a senha ───────────────────────────────
const novaSenha = SENHA ?? crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
if (novaSenha.length < 6) {
  console.error('A senha precisa ter no mínimo 6 caracteres.');
  process.exit(1);
}

// ── 3. Trocar no Supabase Auth, preservando o resto do metadata ──
const { data: existente, error: getErr } = await db.auth.admin.getUserById(usuario.id);
if (getErr || !existente?.user) {
  console.error('Erro ao ler o usuário no Auth:', getErr?.message ?? 'não encontrado');
  process.exit(1);
}

const { error: updErr } = await db.auth.admin.updateUserById(usuario.id, {
  password: novaSenha,
  user_metadata: {
    ...existente.user.user_metadata,
    ...(FORCAR_TROCA ? { must_change_password: true } : {}),
  },
});
if (updErr) { console.error('Erro ao resetar a senha:', updErr.message); process.exit(1); }

console.log('✅ Senha resetada com sucesso.');
console.log(`   Usuário   : ${usuario.full_name} <${usuario.email}> (${usuario.role})`);
console.log(`   Senha nova: ${novaSenha}`);
console.log(FORCAR_TROCA
  ? '   Vai ser obrigado a trocar a senha no próximo login.'
  : '   NÃO vai ser obrigado a trocar — pode usar essa senha permanentemente.');
