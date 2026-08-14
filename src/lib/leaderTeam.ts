// ============================================================
// "Quem é o meu time?" — resolução única, usada pelo Dashboard e por
// Relatórios quando quem está logado é um líder.
//
// Antes de 14/08/2026 cada tela tinha a própria cópia de um casamento por
// TEXTO: comparava o nome do perfil com o campo collaborators.leader,
// tentando variações de "todas as palavras do nome aparecem no outro".
// Isso errava nos dois sentidos, porque aquele campo é digitado à mão —
// dos 659 valores distintos, 411 são e-mail e 248 são nome solto.
//
// Agora a resposta certa vem do vínculo já resolvido no banco
// (collaborators.leader_id, preenchido por resolve_leader_links()), e o
// casamento por texto fica só como rede de segurança enquanto os líderes
// não estiverem todos cadastrados.
// ============================================================

export interface TeamMemberLike {
  id: string;
  leader?: string | null;
  email?: string | null;
  is_leader?: boolean;
  leader_id?: string | null;
}

export interface LeaderProfileLike {
  full_name?: string | null;
  email?: string | null;
  /** Nome/e-mail exato como aparece em collaborators.leader. */
  leader_key?: string | null;
}

/** O casamento antigo, por texto. Mantido só como plano B. */
export function matchesLeaderText(
  collaboratorLeader: string | null | undefined,
  profile: LeaderProfileLike | null | undefined
): boolean {
  const cLeader = (collaboratorLeader ?? '').trim().toUpperCase();
  if (!cLeader) return false;

  // O campo leader guarda e-mail em 411 dos 659 casos — comparar com o
  // e-mail do perfil resolve esses direto, sem heurística de nome.
  const email = (profile?.email ?? '').trim().toUpperCase();
  if (email && cLeader === email) return true;

  if (profile?.leader_key) return cLeader === profile.leader_key.trim().toUpperCase();

  const profileName = (profile?.full_name ?? '').trim().toUpperCase();
  if (!profileName) return false;
  if (cLeader === profileName) return true;

  const nameWords = profileName.split(/\s+/).filter(w => w.length > 2);
  if (nameWords.length > 0 && nameWords.every(w => cLeader.includes(w))) return true;
  const leaderWords = cLeader.split(/\s+/).filter(w => w.length > 2);
  if (leaderWords.length > 0 && leaderWords.every(w => profileName.includes(w))) return true;
  return false;
}

/**
 * O time do líder logado: os liderados dele + a própria linha dele (o
 * treinamento do líder também conta).
 *
 * Usa leader_id quando o líder está cadastrado (caminho confiável) e cai
 * para o casamento por texto quando ainda não está.
 */
export function filterTeamOfLeader<T extends TeamMemberLike>(
  collaborators: T[],
  profile: LeaderProfileLike | null | undefined
): T[] {
  const email = (profile?.email ?? '').trim().toLowerCase();
  const leaderRow = email
    ? collaborators.find(c => c.is_leader && (c.email ?? '').trim().toLowerCase() === email)
    : undefined;

  if (leaderRow) {
    const team = collaborators.filter(c => c.leader_id === leaderRow.id || c.id === leaderRow.id);
    // Só 1 = achamos o líder mas ninguém está vinculado a ele ainda. Nesse
    // caso o texto ainda é a melhor pista, então não devolvemos um time vazio.
    if (team.length > 1) return team;
  }

  return collaborators.filter(c => matchesLeaderText(c.leader, profile));
}
