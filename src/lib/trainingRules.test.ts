import { describe, it, expect } from 'vitest';
import {
  isMicroCompletedBy,
  isAreaTrained,
  isCollaboratorTrained,
  calculateSocHealth,
  calculateAreaStats,
  calculateOverallTrainedPct,
  calculateUnitStats,
  collaboratorArea,
  normalizeMacroArea,
  OTHER_AREA,
  type MicroTraining,
  type CollaboratorLite,
} from './trainingRules';

// Matriz de referência: SP6 (4 Recebimento + 7 Processamento + 3 Expedição + 9 Tratativas)
const RECEB: MicroTraining[] = [
  { name: 'Recebimento FM', macro_area: 'RECEBIMENTO' },
  { name: 'Recebimento LH', macro_area: 'RECEBIMENTO' },
  { name: 'Transbordo', macro_area: 'RECEBIMENTO' },
  { name: 'Puxada IN', macro_area: 'RECEBIMENTO' },
];
const PROC: MicroTraining[] = [
  { name: 'Indução', macro_area: 'PROCESSAMENTO' },
  { name: 'Esteira Automática', macro_area: 'PROCESSAMENTO' },
  { name: 'Esteira Java', macro_area: 'PROCESSAMENTO' },
  { name: 'Esteira Termoplastica', macro_area: 'PROCESSAMENTO' },
  { name: 'Setup', macro_area: 'PROCESSAMENTO' },
  { name: 'TETRIS', macro_area: 'PROCESSAMENTO' },
  { name: 'Goleiro', macro_area: 'PROCESSAMENTO' },
];
const EXPED: MicroTraining[] = [
  { name: 'Puxada Out', macro_area: 'EXPEDIÇÃO' },
  { name: 'Tipos de Carregamento', macro_area: 'EXPEDIÇÃO' },
  { name: 'Expedição LH', macro_area: 'EXPEDIÇÃO' },
];
const TRAT: MicroTraining[] = [
  { name: 'Tratativas', macro_area: 'TRATATIVAS' },
  { name: 'Returns', macro_area: 'TRATATIVAS' },
  { name: 'Receita Federal', macro_area: 'TRATATIVAS' },
  { name: 'Faded', macro_area: 'TRATATIVAS' },
  { name: 'Recebimento Correios', macro_area: 'TRATATIVAS' },
  { name: 'Recebimento 3PL', macro_area: 'TRATATIVAS' },
  { name: 'SIP', macro_area: 'TRATATIVAS' },
  { name: 'Reetiquetagem', macro_area: 'TRATATIVAS' },
  { name: 'Liquidation', macro_area: 'TRATATIVAS' },
];
const SP6_MICROS = [...RECEB, ...PROC, ...EXPED, ...TRAT];

// SP6 não tem Sorter — daí o hasSorting = false em toda esta tabela.
function countHits(trainingType: string, micros: MicroTraining[]): number {
  return micros.filter(m => isMicroCompletedBy(trainingType, m.name, m.macro_area, false)).length;
}

describe('trainingRules — matriz de referência SP6 (tabela validada)', () => {
  it('Onboarding PTS V3 acende as 3 áreas core inteiras e nada de Tratativas', () => {
    expect(countHits('Onboarding PTS V3', RECEB)).toBe(4);
    expect(countHits('Onboarding PTS V3', PROC)).toBe(7);
    expect(countHits('Onboarding PTS V3', EXPED)).toBe(3);
    expect(countHits('Onboarding PTS V3', TRAT)).toBe(0);
  });

  it('Onboarding PTS - Sem Sorter tem o mesmo efeito do PTS padrão', () => {
    expect(countHits('Onboarding PTS - Sem Sorter', RECEB)).toBe(4);
    expect(countHits('Onboarding PTS - Sem Sorter', PROC)).toBe(7);
    expect(countHits('Onboarding PTS - Sem Sorter', EXPED)).toBe(3);
  });

  it('Onboarding PTS - Com Sorter acende as 3 core + ASM', () => {
    const asm: MicroTraining[] = [{ name: 'Sorter Base', macro_area: 'ASM' }];
    expect(countHits('Onboarding PTS - Com Sorter', RECEB)).toBe(4);
    expect(countHits('Onboarding PTS - Com Sorter', PROC)).toBe(7);
    expect(countHits('Onboarding PTS - Com Sorter', EXPED)).toBe(3);
    expect(countHits('Onboarding PTS - Com Sorter', asm)).toBe(1);
  });

  it('02. Treinamento Padrão SOC - Processamento acende só Processamento (7/7)', () => {
    expect(countHits('02. Treinamento Padrão SOC - Processamento', RECEB)).toBe(0);
    expect(countHits('02. Treinamento Padrão SOC - Processamento', PROC)).toBe(7);
    expect(countHits('02. Treinamento Padrão SOC - Processamento', EXPED)).toBe(0);
    expect(countHits('02. Treinamento Padrão SOC - Processamento', TRAT)).toBe(0);
  });

  it('01. Treinamento Padrão SOC - Recebimento acende só Recebimento — sem vazar para Tratativas (fix R1)', () => {
    expect(countHits('01. Treinamento Padrão SOC - Recebimento', RECEB)).toBe(4);
    expect(countHits('01. Treinamento Padrão SOC - Recebimento', TRAT)).toBe(0);
  });

  it('03. Treinamento Padrão SOC - Expedição acende só Expedição (3/3)', () => {
    expect(countHits('03. Treinamento Padrão SOC - Expedição', EXPED)).toBe(3);
    expect(countHits('03. Treinamento Padrão SOC - Expedição', RECEB)).toBe(0);
  });

  it('04. Treinamento Padrão SOC - Tratativas acende a área Tratativas inteira (9/9, fix)', () => {
    expect(countHits('04. Treinamento Padrão SOC - Tratativas', TRAT)).toBe(9);
  });

  it('00. Treinamento Padrão SOC - ASM acende a macro ASM inteira', () => {
    const asm: MicroTraining[] = [
      { name: 'Sorter Base', macro_area: 'ASM' },
      { name: 'Sorter Avançado', macro_area: 'ASM' },
    ];
    expect(countHits('00. Treinamento Padrão SOC - ASM', asm)).toBe(2);
  });

  // Regressão: este é o nome REAL usado na operação (1.474 assinaturas na
  // planilha de importação de 12/08/2026). O sufixo é "SORTER ASM", não
  // "ASM" — com a comparação exata anterior ele não acendia nada aqui,
  // enquanto a função do banco (ILIKE '%asm%') acendia. As duas precisam
  // concordar, senão o Relatório e o card de saúde mostram números
  // diferentes para a mesma pessoa.
  it('06. Treinamento Padrão SOC - Sorter (ASM) acende a macro ASM', () => {
    const asm: MicroTraining[] = [
      { name: 'Sorter Base', macro_area: 'ASM' },
      { name: 'Sorter Avançado', macro_area: 'ASM' },
    ];
    expect(countHits('06. Treinamento Padrão SOC - Sorter (ASM)', asm)).toBe(2);
    expect(isAreaTrained(['06. Treinamento Padrão SOC - Sorter (ASM)'], 'ASM', false)).toBe(true);
  });

  it('o sufixo com nome de área não vaza para as outras áreas', () => {
    expect(isAreaTrained(['06. Treinamento Padrão SOC - Sorter (ASM)'], 'RECEBIMENTO', false)).toBe(false);
    expect(isAreaTrained(['06. Treinamento Padrão SOC - Sorter (ASM)'], 'PROCESSAMENTO', false)).toBe(false);
    expect(isAreaTrained(['06. Treinamento Padrão SOC - Sorter (ASM)'], 'EXPEDIÇÃO', false)).toBe(false);
    // "PROCESSAMENTO" contém "SAM", não "ASM" — não pode acender ASM
    expect(isAreaTrained(['02. Treinamento Padrão SOC - Processamento'], 'ASM', false)).toBe(false);
  });

  it.each([
    'Onboarding Meio Ambiente',
    'Onboarding People',
    'Onboarding HSE',
    'Onboarding Security',
    'Onboarding Qualidade',
  ])('%s (onboarding administrativo) não acende nenhum micro operacional', (tipo) => {
    expect(countHits(tipo, SP6_MICROS)).toBe(0);
  });

  it('05. Treinamento Padrão SOC - Returns acende só o micro Returns (1/9 em Tratativas)', () => {
    expect(countHits('05. Treinamento Padrão SOC - Returns', TRAT)).toBe(1);
    expect(isMicroCompletedBy('05. Treinamento Padrão SOC - Returns', 'Returns', 'TRATATIVAS', false)).toBe(true);
    expect(isMicroCompletedBy('05. Treinamento Padrão SOC - Returns', 'Tratativas', 'TRATATIVAS', false)).toBe(false);
  });

  it('treinamento com código de documento e versão casa com o micro por nome, tolerando mudança de versão', () => {
    expect(
      isMicroCompletedBy('SPX_BR_PTS_SOC_031 - Interceptações Receita Federal - V.11', 'Receita Federal', 'TRATATIVAS', false)
    ).toBe(true);
    expect(
      isMicroCompletedBy('SPX_BR_PTS_SOC_031 - Interceptações Receita Federal - V.12', 'Receita Federal', 'TRATATIVAS', false)
    ).toBe(true);
  });

  it('treinamento sem correspondência não acende nenhum micro', () => {
    expect(countHits('Check List Outbound', SP6_MICROS)).toBe(0);
  });
});

describe('trainingRules — normalizeMacroArea', () => {
  it('reconhece as 5 macro-áreas com acentos e variações', () => {
    expect(normalizeMacroArea('Recebimento')).toBe('RECEBIMENTO');
    expect(normalizeMacroArea('Expedição')).toBe('EXPEDIÇÃO');
    expect(normalizeMacroArea('Expedicao')).toBe('EXPEDIÇÃO');
    expect(normalizeMacroArea('Tratativas')).toBe('TRATATIVAS');
    expect(normalizeMacroArea('ASM')).toBe('ASM');
  });
});

describe('trainingRules — isAreaTrained (card % Treinados / Matriz / gráfico)', () => {
  it('Onboarding PTS treina as 3 áreas core, mas não Tratativas', () => {
    expect(isAreaTrained(['ONBOARDING PTS V3'], 'RECEBIMENTO', false)).toBe(true);
    expect(isAreaTrained(['ONBOARDING PTS V3'], 'PROCESSAMENTO', false)).toBe(true);
    expect(isAreaTrained(['ONBOARDING PTS V3'], 'EXPEDIÇÃO', false)).toBe(true);
    expect(isAreaTrained(['ONBOARDING PTS V3'], 'TRATATIVAS', false)).toBe(false);
  });

  it('onboarding administrativo isolado não treina nenhuma área operacional (fix R2)', () => {
    expect(isAreaTrained(['ONBOARDING PEOPLE', 'ONBOARDING MEIO AMBIENTE'], 'RECEBIMENTO', false)).toBe(false);
    expect(isAreaTrained(['ONBOARDING PEOPLE', 'ONBOARDING MEIO AMBIENTE'], 'PROCESSAMENTO', false)).toBe(false);
  });

  it('Padrão SOC de uma área treina só aquela área', () => {
    expect(isAreaTrained(['04. TREINAMENTO PADRÃO SOC - TRATATIVAS'], 'TRATATIVAS', false)).toBe(true);
    expect(isAreaTrained(['04. TREINAMENTO PADRÃO SOC - TRATATIVAS'], 'RECEBIMENTO', false)).toBe(false);
  });

  it('Com Sorter treina ASM', () => {
    expect(isAreaTrained(['ONBOARDING PTS - COM SORTER'], 'ASM', true)).toBe(true);
    expect(isAreaTrained(['ONBOARDING PTS V3'], 'ASM', true)).toBe(false);
  });
});

describe('trainingRules — calculateSocHealth', () => {
  // Nomes distintos sem prefixo comum, para não colidir com o match por
  // substring do matchesMicroByName (ex: "Micro 1" seria substring de "Micro 10").
  const MICRO_NAMES = [
    'Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo',
    'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett',
    'Kilo', 'Lima', 'Mike', 'November',
  ];
  const N14 = MICRO_NAMES.map((name, i) => ({ name, macro_area: i < 5 ? 'RECEBIMENTO' : i < 10 ? 'PROCESSAMENTO' : 'EXPEDIÇÃO' }));

  it('exemplo do usuário: Ygor 7/14, Bruno 14/14 → saúde 75%', () => {
    const collabs: CollaboratorLite[] = [
      { id: 'ygor', sector: 'RECEBIMENTO' },
      { id: 'bruno', sector: 'RECEBIMENTO' },
    ];
    const trainingsByCollabId = new Map<string, string[]>([
      ['ygor', MICRO_NAMES.slice(0, 7)],
      ['bruno', MICRO_NAMES],
    ]);
    const result = calculateSocHealth(N14, collabs, trainingsByCollabId, false);
    expect(result.eligible).toBe(true);
    expect(result.microCount).toBe(14);
    expect(result.healthPct).toBe(75);
  });

  it('SOC com menos de 14 micros core não é elegível, mesmo com 100% de conclusão', () => {
    const micros13 = N14.slice(0, 13);
    const collabs: CollaboratorLite[] = [{ id: 'a', sector: 'RECEBIMENTO' }];
    const trainingsByCollabId = new Map<string, string[]>([['a', micros13.map(m => m.name)]]);
    const result = calculateSocHealth(micros13, collabs, trainingsByCollabId, false);
    expect(result.eligible).toBe(false);
    expect(result.missing).toBe(1);
  });

  it('N real acima de 14 usa o total real como denominador (D2)', () => {
    const micros17 = [...N14, { name: 'Papa', macro_area: 'EXPEDIÇÃO' }, { name: 'Quebec', macro_area: 'EXPEDIÇÃO' }, { name: 'Romeo', macro_area: 'EXPEDIÇÃO' }];
    const collabs: CollaboratorLite[] = [{ id: 'a', sector: 'RECEBIMENTO' }];
    const trainingsByCollabId = new Map<string, string[]>([['a', MICRO_NAMES]]);
    const result = calculateSocHealth(micros17, collabs, trainingsByCollabId, false);
    expect(result.microCount).toBe(17);
    expect(result.healthPct).toBeCloseTo((14 / 17) * 100, 1);
  });

  it('ASM entra no denominador só quando a SOC tem sorting', () => {
    const withAsm = [...N14, { name: 'Sorter Base', macro_area: 'ASM' }];
    const collabs: CollaboratorLite[] = [{ id: 'a', sector: 'RECEBIMENTO' }];
    const trainingsByCollabId = new Map<string, string[]>([['a', N14.map(m => m.name)]]);

    const semSorting = calculateSocHealth(withAsm, collabs, trainingsByCollabId, false);
    expect(semSorting.microCount).toBe(14); // ASM ignorado

    const comSorting = calculateSocHealth(withAsm, collabs, trainingsByCollabId, true);
    expect(comSorting.microCount).toBe(15); // ASM contado, e ainda >= 14 então elegível
  });

  it('sem colaboradores elegíveis, saúde fica em 0 mas a SOC continua elegível (matriz completa)', () => {
    const result = calculateSocHealth(N14, [], new Map(), false);
    expect(result.eligible).toBe(true);
    expect(result.evaluatedCollaborators).toBe(0);
    expect(result.healthPct).toBe(0);
  });
});

describe('trainingRules — calculateAreaStats / calculateOverallTrainedPct', () => {
  it('só considera colaboradores com setor preenchido', () => {
    const collabs: CollaboratorLite[] = [
      { id: '1', sector: 'RECEBIMENTO' },
      { id: '2', sector: null },
      { id: '3', sector: '' },
      { id: '4', sector: 'PROCESSAMENTO' },
    ];
    const trainingsByCollabId = new Map<string, string[]>([
      ['1', ['01. TREINAMENTO PADRÃO SOC - RECEBIMENTO']],
      ['4', []],
    ]);
    const stats = calculateAreaStats(collabs, trainingsByCollabId, false);
    const receb = stats.find(s => s.area === 'RECEBIMENTO')!;
    expect(receb.total).toBe(1);
    expect(receb.trained).toBe(1);
    const overall = calculateOverallTrainedPct(stats);
    // total = 1 (Receb) + 1 (Proc) = 2 (colaboradores 2 e 3 ficam de fora, sem setor)
    expect(overall.total).toBe(2);
  });

  it('inclui ASM nas áreas operacionais quando hasSorting é true', () => {
    const stats = calculateAreaStats([], new Map(), true);
    expect(stats.map(s => s.area)).toContain('ASM');
    const statsSemSorting = calculateAreaStats([], new Map(), false);
    expect(statsSemSorting.map(s => s.area)).not.toContain('ASM');
  });
});

// ============================================================
// A pergunta canônica — a mesma que as três telas fazem desde 13/08/2026.
// Cada caso abaixo veio de uma divergência real entre telas.
// ============================================================
describe('trainingRules — isCollaboratorTrained', () => {
  it('conta o treinamento da área DA PESSOA, não o de qualquer área', () => {
    // ANA CLAUDIA (SC1): é do Recebimento e só fez o de Processamento.
    // A exportação de pendentes dizia que ela estava treinada.
    expect(isCollaboratorTrained('RECEBIMENTO', ['02. Treinamento Padrão SOC - Processamento'], false)).toBe(false);
    expect(isCollaboratorTrained('RECEBIMENTO', ['01. Treinamento Padrão SOC - Recebimento'], false)).toBe(true);
  });

  it('Tratativas exige o treinamento próprio — Onboarding PTS não basta', () => {
    expect(isCollaboratorTrained('TRATATIVAS', ['Onboarding PTS V3'], false)).toBe(false);
    expect(isCollaboratorTrained('TRATATIVAS', ['Onboarding PTS - Com Sorter'], true)).toBe(false);
    expect(isCollaboratorTrained('TRATATIVAS', ['04. Treinamento Padrão SOC - Tratativas'], false)).toBe(true);
  });

  it('Onboarding PTS treina as três áreas core', () => {
    for (const setor of ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO']) {
      expect(isCollaboratorTrained(setor, ['Onboarding PTS - Sem Sorter'], false)).toBe(true);
    }
  });

  it('exceção do Sorter: quem é de Processamento e fez o Sorter (ASM) está treinado', () => {
    // BIANCA GONCALVES TEMISTOCLES (SP8) e mais 967 pessoas.
    expect(isCollaboratorTrained('PROCESSAMENTO', ['06. Treinamento Padrão SOC - Sorter (ASM)'], true)).toBe(true);
    // ...mas o Sorter não treina quem é do Recebimento ou da Expedição.
    expect(isCollaboratorTrained('RECEBIMENTO', ['06. Treinamento Padrão SOC - Sorter (ASM)'], true)).toBe(false);
    expect(isCollaboratorTrained('EXPEDIÇÃO', ['06. Treinamento Padrão SOC - Sorter (ASM)'], true)).toBe(false);
  });

  it('sem setor operacional (Apoio, Almox, vazio): qualquer treinamento de área conta', () => {
    for (const setor of ['Apoio', 'Almox', '', null, undefined]) {
      expect(isCollaboratorTrained(setor, ['Onboarding PTS V3'], false)).toBe(true);
      expect(isCollaboratorTrained(setor, ['01. Treinamento Padrão SOC - Recebimento'], false)).toBe(true);
      expect(isCollaboratorTrained(setor, [], false)).toBe(false);
    }
  });

  it('onboarding administrativo não treina ninguém, tenha setor ou não', () => {
    expect(isCollaboratorTrained('Apoio', ['Onboarding HSE', 'Onboarding People'], false)).toBe(false);
    expect(isCollaboratorTrained('PROCESSAMENTO', ['Onboarding HSE'], false)).toBe(false);
  });

  // Mudou em 03/09/2026: sem sorting a pessoa ia para OUTROS. Agora vai
  // para PROCESSAMENTO — ver o describe "setor ASM numa SOC sem sorter"
  // mais abaixo para o porquê.
  it('ASM só é uma área própria quando a SOC tem sorting', () => {
    expect(collaboratorArea('ASM', true)).toBe('ASM');
    expect(collaboratorArea('ASM', false)).toBe('PROCESSAMENTO');
    expect(collaboratorArea('Apoio', true)).toBe(OTHER_AREA);
    expect(collaboratorArea('Expedicao', false)).toBe('EXPEDIÇÃO');
  });

  // Achado em RJ2 em 02/09/2026: o card "ASM" mostrava 0/0 mesmo com 392
  // pessoas de Processamento fazendo Sorter — porque NENHUM colaborador tem
  // sector literalmente "ASM" nos dados reais (RH usa "Processamento" para
  // todo mundo do setor, Sorter incluso). A matriz de certificação, que
  // decide por treinamento e não por setor, mostrava os ticks acesos
  // certinho — só o card de cima estava errado.
  describe('exceção do Sorter também move a pessoa para o grupo ASM (não só treina)', () => {
    it.each([
      ['ASM | Chutes', 'RJ2'],
      ['ASM - Looping C (Zona 1)', 'SP8'],
      ['ASM Nível 1', 'SP2'],
    ])('activity "%s" (padrão de %s) bota a pessoa no grupo ASM, não Processamento', (activity) => {
      expect(collaboratorArea('PROCESSAMENTO', true, activity)).toBe('ASM');
    });

    it('sem sorting na SOC, continua Processamento mesmo com activity de Sorter', () => {
      expect(collaboratorArea('PROCESSAMENTO', false, 'ASM | Chutes')).toBe('PROCESSAMENTO');
    });

    it('Processamento comum (sem activity de Sorter) continua Processamento', () => {
      expect(collaboratorArea('PROCESSAMENTO', true, 'Esteira | Processamento')).toBe('PROCESSAMENTO');
      expect(collaboratorArea('PROCESSAMENTO', true, null)).toBe('PROCESSAMENTO');
    });

    it('MG2 não marca activity de Sorter — continua Processamento, e está certo: não há como saber quem é Sorter sem essa marcação', () => {
      expect(collaboratorArea('PROCESSAMENTO', true, 'Esteira | Processamento')).toBe('PROCESSAMENTO');
    });

    it('isCollaboratorTrained: a pessoa do Sorter conta como treinada E cai no grupo certo', () => {
      const trained = isCollaboratorTrained('PROCESSAMENTO', ['06. Treinamento Padrão SOC - Sorter (ASM)'], true, 'ASM | Chutes');
      expect(trained).toBe(true);
      expect(collaboratorArea('PROCESSAMENTO', true, 'ASM | Chutes')).toBe('ASM');
    });

    it('não confunde "ASM" no meio do texto com o prefixo — só conta se começar com ASM', () => {
      expect(collaboratorArea('PROCESSAMENTO', true, 'Apoio ASM')).toBe('PROCESSAMENTO');
    });
  });

  // Pedido de 02/09/2026: líder (is_leader) com "Onboarding Líderes" ou
  // "Onboarding Líderes 2.0" conta como treinado, mesmo sem setor
  // operacional — hoje "Onboarding Lideres" já existe no banco (93 líderes
  // cadastrados, a maioria sem essa assinatura ainda).
  describe('Onboarding Líderes credencia quem é líder (is_leader)', () => {
    it.each([
      'Onboarding Lideres',       // exato, como está gravado no banco hoje
      'Onboarding Líderes',       // com acento
      'Onboarding Líderes 2.0',   // com sufixo de versão
      'ONBOARDING LIDERES',       // maiúsculas
    ])('"%s" treina um líder, mesmo sem setor operacional', (treinamento) => {
      expect(isCollaboratorTrained(null, [treinamento], false, null, true)).toBe(true);
      expect(isCollaboratorTrained('Gestão', [treinamento], false, null, true)).toBe(true);
    });

    it('sem is_leader, o mesmo treinamento NÃO credencia ninguém — é onboarding administrativo (regra 3)', () => {
      expect(isCollaboratorTrained('Gestão', ['Onboarding Lideres'], false, null, false)).toBe(false);
      expect(isCollaboratorTrained(null, ['Onboarding Lideres'], false)).toBe(false); // isLeader nem informado
    });

    it('líder sem essa assinatura continua pendente — o treinamento não é automático', () => {
      expect(isCollaboratorTrained('Gestão', [], false, null, true)).toBe(false);
      expect(isCollaboratorTrained('Gestão', ['Onboarding HSE'], false, null, true)).toBe(false);
    });

    it('é um OU a mais: líder com Onboarding PTS (veio da operação) continua treinado sem precisar do Onboarding Líderes', () => {
      expect(isCollaboratorTrained('RECEBIMENTO', ['Onboarding PTS V3'], false, null, true)).toBe(true);
    });

    it('"Onboarding Liderança 2.0" (nome diferente, já existe no banco) NÃO bate — só "Líderes"', () => {
      expect(isCollaboratorTrained('Gestão', ['Onboarding Liderança 2.0'], false, null, true)).toBe(false);
    });
  });

  // 03/09/2026 — o bug do Aderson: ele aparecia CERTIFICADO na tela de
  // Colaboradores (que lê o espelho SQL, sempre frouxo aqui) e PENDENTE na
  // exportação de Relatórios (que lê este arquivo, que exigia a frase
  // "ONBOARDING PTS" colada). 852 pessoas em 5 SOCs, todas por causa deste
  // único nome. SP2 mostrava 32,5% num lado e 77,9% no outro.
  describe('"Onboarding" + "PTS" contam em qualquer posição do nome', () => {
    it('"Onboarding Novos Colaboradores PTS" credencia Recebimento, Processamento e Expedição', () => {
      for (const area of ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO'] as const) {
        expect(isAreaTrained(['Onboarding Novos Colaboradores PTS'], area, false)).toBe(true);
      }
    });

    it('não credencia Tratativas — nenhum onboarding credencia', () => {
      expect(isAreaTrained(['Onboarding Novos Colaboradores PTS'], 'TRATATIVAS', false)).toBe(false);
      expect(isAreaTrained(['Onboarding Novos Colaboradores PTS'], 'TRATATIVAS', true)).toBe(false);
    });

    it('o caso relatado: sem setor cadastrado, esse onboarding basta para estar treinado', () => {
      expect(isCollaboratorTrained('', ['Onboarding Novos Colaboradores PTS'], false)).toBe(true);
      expect(isCollaboratorTrained(null, ['Onboarding Novos Colaboradores PTS'], false)).toBe(true);
    });

    it.each([
      'Onboarding PTS V3',
      'Onboarding PTS - Sem Sorter',
      'Onboarding Novos Colaboradores PTS',
    ])('"%s" não credencia ASM numa SOC sem Sorter', (treinamento) => {
      expect(isAreaTrained([treinamento], 'ASM', false)).toBe(false);
    });

    it('"Onboarding PTS - Com Sorter" credencia ASM', () => {
      expect(isAreaTrained(['Onboarding PTS - Com Sorter'], 'ASM', true)).toBe(true);
    });

    // A contrapartida de afrouxar a posição das palavras: o código do
    // documento contém "PTS" ("SPX_BR_PTS_SOC_031"). Sem descartá-lo antes
    // da comparação, QUALQUER onboarding com código no nome credenciaria
    // três áreas. Não existe nome assim hoje — este teste é o que impede
    // que passe a existir sem ninguém perceber.
    it.each([
      'Onboarding SPX_BR_PTS_SOC_062',
      'Onboarding HSE SPX_BR_PTS_SOC_031 - V.12',
    ])('"%s" NÃO credencia nada — o "PTS" ali é código de documento, não o treinamento', (treinamento) => {
      for (const area of ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'ASM'] as const) {
        expect(isAreaTrained([treinamento], area, false)).toBe(false);
        expect(isAreaTrained([treinamento], area, true)).toBe(false);
      }
    });

    it.each([
      'Onboarding People',
      'Onboarding HSE',
      'Onboarding Meio Ambiente',
      'Onboarding Qualidade',
      'Onboarding Security',
    ])('"%s" continua sendo onboarding administrativo — não credencia nada (regra 3)', (treinamento) => {
      expect(isCollaboratorTrained(null, [treinamento], false)).toBe(false);
      expect(isCollaboratorTrained('RECEBIMENTO', [treinamento], false)).toBe(false);
    });
  });

  // 03/09/2026 — segunda decisão do Ygor: nas SOCs COM Sorter, o
  // "Onboarding Novos Colaboradores PTS" acende o tick de ASM também. É o
  // nome que SP2 usa para o onboarding completo (1.197 assinaturas de lá).
  describe('"Onboarding Novos Colaboradores PTS" acende ASM só onde há Sorter', () => {
    it('numa SOC COM Sorter, credencia as 3 áreas core E o ASM', () => {
      for (const area of ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'ASM'] as const) {
        expect(isAreaTrained(['Onboarding Novos Colaboradores PTS'], area, true)).toBe(true);
      }
    });

    it('numa SOC SEM Sorter, o ASM continua apagado', () => {
      expect(isAreaTrained(['Onboarding Novos Colaboradores PTS'], 'ASM', false)).toBe(false);
    });

    // O contrário disto seria acender ASM para as 986 assinaturas de
    // "Onboarding PTS V3" de RJ2 — que usa "Com Sorter" explicitamente
    // para quem fez o treinamento do Sorter.
    it.each([
      'Onboarding PTS V3',
      'Onboarding PTS - Sem Sorter',
    ])('"%s" NÃO acende ASM nem numa SOC com Sorter — a regra é só do nome "Novos Colaboradores"', (treinamento) => {
      expect(isAreaTrained([treinamento], 'ASM', true)).toBe(false);
    });

    it('quem faz Sorter em SOC com Sorter fica treinado com esse onboarding', () => {
      // setor Processamento + activity de Sorter → área ASM
      expect(collaboratorArea('PROCESSAMENTO', true, 'ASM | Chutes')).toBe('ASM');
      expect(
        isCollaboratorTrained('PROCESSAMENTO', ['Onboarding Novos Colaboradores PTS'], true, 'ASM | Chutes')
      ).toBe(true);
    });

    it('e o tick da Matriz de Certificação acende junto (mesma regra, mesmo motor)', () => {
      expect(isMicroCompletedBy('Onboarding Novos Colaboradores PTS', 'Sorter Base', 'ASM', true)).toBe(true);
      expect(isMicroCompletedBy('Onboarding Novos Colaboradores PTS', 'Sorter Base', 'ASM', false)).toBe(false);
    });
  });

  // 03/09/2026 — decisão do Ygor: setor "ASM" numa SOC que não tem Sorter é
  // contradição no dado; a pessoa entra em Processamento em todas as telas.
  // Antes caía em OUTROS, onde a régua é "qualquer treinamento de área
  // serve" — diferente da do banco, que a cobrava como ASM. Era o caso da
  // Kayane (CE3), a única pessoa nessa situação hoje.
  describe('setor ASM numa SOC sem sorter cai em Processamento', () => {
    it('sem sorter na SOC, o grupo é Processamento; com sorter, continua ASM', () => {
      expect(collaboratorArea('ASM', false)).toBe('PROCESSAMENTO');
      expect(collaboratorArea('ASM', true)).toBe('ASM');
    });

    it('e passa a ser cobrada pela régua de Processamento', () => {
      expect(isCollaboratorTrained('ASM', ['Onboarding PTS V3'], false)).toBe(true);
      expect(isCollaboratorTrained('ASM', ['02. Treinamento Padrão SOC - Processamento'], false)).toBe(true);
    });

    it('numa SOC COM sorter, setor ASM continua exigindo o treinamento de ASM', () => {
      expect(isCollaboratorTrained('ASM', ['02. Treinamento Padrão SOC - Processamento'], true)).toBe(false);
      expect(isCollaboratorTrained('ASM', ['06. Treinamento Padrão SOC - Sorter (ASM)'], true)).toBe(true);
    });
  });
});

describe('trainingRules — calculateUnitStats (o número oficial da unidade)', () => {
  const collabs: CollaboratorLite[] = [
    { id: 'r1', sector: 'RECEBIMENTO' },
    { id: 'p1', sector: 'PROCESSAMENTO' },
    { id: 't1', sector: 'TRATATIVAS' },
    { id: 'a1', sector: 'Apoio' },
    { id: 'a2', sector: null },
  ];
  const trainings = new Map<string, string[]>([
    ['r1', ['Onboarding PTS V3']],
    ['p1', ['Onboarding PTS V3']],
    ['t1', ['Onboarding PTS V3']],   // não basta para Tratativas
    ['a1', ['Onboarding PTS V3']],   // basta, pois Apoio não é área operacional
    ['a2', []],
  ]);

  it('ninguém fica de fora: a soma das áreas fecha com o total', () => {
    const stats = calculateUnitStats(collabs, trainings, false);
    expect(stats.total).toBe(5);
    expect(stats.byArea.reduce((s, a) => s + a.total, 0)).toBe(5);
  });

  it('conta Apoio e sem-setor no grupo OUTROS, em vez de ignorá-los', () => {
    const stats = calculateUnitStats(collabs, trainings, false);
    const outros = stats.byArea.find(a => a.area === OTHER_AREA)!;
    expect(outros.total).toBe(2);
    expect(outros.trained).toBe(1);
  });

  it('o geral reflete a regra de Tratativas', () => {
    const stats = calculateUnitStats(collabs, trainings, false);
    // r1, p1 e a1 treinados; t1 (só onboarding) e a2 (nada) pendentes.
    expect(stats.trained).toBe(3);
    expect(stats.pct).toBe(60);
  });
});
