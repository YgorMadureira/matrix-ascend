import { describe, it, expect } from 'vitest';
import { filterTeamOfLeader, matchesLeaderText } from './leaderTeam';

// Os casos abaixo vêm da bagunça real do campo collaborators.leader em
// 14/08/2026: 659 valores distintos, 411 e-mails e 248 nomes soltos.
const LIDER = {
  id: 'lider-1',
  is_leader: true,
  email: 'victor.nsilva@shopee.com',
  leader: 'CARLOS GESTOR',
  leader_id: null,
};

describe('leaderTeam — filterTeamOfLeader', () => {
  it('usa leader_id quando o líder está cadastrado, ignorando a grafia do campo texto', () => {
    const base = [
      LIDER,
      { id: 'a', leader: 'victor.nsilva@shopee.com', leader_id: 'lider-1' },
      { id: 'b', leader: 'Victor N Silva', leader_id: 'lider-1' }, // grafia diferente, mesmo vínculo
      { id: 'c', leader: 'outro.lider@shopee.com', leader_id: 'lider-2' },
    ];
    const time = filterTeamOfLeader(base, { email: 'victor.nsilva@shopee.com', full_name: 'Victor N Silva' });
    expect(time.map(c => c.id).sort()).toEqual(['a', 'b', 'lider-1']);
  });

  it('inclui o próprio líder no time — o treinamento dele também conta', () => {
    const base = [LIDER, { id: 'a', leader: 'x', leader_id: 'lider-1' }];
    const time = filterTeamOfLeader(base, { email: 'victor.nsilva@shopee.com' });
    expect(time.some(c => c.id === 'lider-1')).toBe(true);
  });

  it('cai para o casamento por texto quando o líder ainda não tem ninguém vinculado', () => {
    // Situação dos 637 líderes que hoje só existem como texto.
    const base = [
      { id: 'a', leader: 'BEATRIZ LOPES', leader_id: null },
      { id: 'b', leader: 'OUTRA PESSOA', leader_id: null },
    ];
    const time = filterTeamOfLeader(base, { full_name: 'Beatriz Lopes' });
    expect(time.map(c => c.id)).toEqual(['a']);
  });

  it('não devolve time vazio só porque o líder cadastrado ainda não foi resolvido', () => {
    const base = [
      { ...LIDER, id: 'lider-1' },
      { id: 'a', leader: 'victor.nsilva@shopee.com', leader_id: null }, // ainda não resolvido
    ];
    const time = filterTeamOfLeader(base, { email: 'victor.nsilva@shopee.com' });
    expect(time.map(c => c.id)).toContain('a');
  });
});

describe('leaderTeam — matchesLeaderText', () => {
  it('casa por e-mail, que é o formato de 411 dos 659 valores', () => {
    expect(matchesLeaderText('victor.nsilva@shopee.com', { email: 'victor.nsilva@shopee.com' })).toBe(true);
    expect(matchesLeaderText('VICTOR.NSILVA@SHOPEE.COM', { email: 'victor.nsilva@shopee.com' })).toBe(true);
  });

  it('leader_key, quando preenchido, manda em cima do nome', () => {
    expect(matchesLeaderText('ODIRLEI MORAES', { full_name: 'Outro Nome', leader_key: 'ODIRLEI MORAES' })).toBe(true);
    expect(matchesLeaderText('ODIRLEI MORAES', { full_name: 'Odirlei Moraes', leader_key: 'NAO BATE' })).toBe(false);
  });

  it('campo vazio nunca casa — senão todo mundo sem líder viraria time de alguém', () => {
    expect(matchesLeaderText('', { full_name: 'Fulano' })).toBe(false);
    expect(matchesLeaderText(null, { full_name: 'Fulano' })).toBe(false);
  });
});
