import { describe, it, expect } from 'vitest';
import {
  agruparPorUnidade,
  chaveInscricao,
  descreverQuando,
  ehRecorrente,
  intervaloDoPeriodo,
  montarLinhas,
  paraCsv,
  proximaOcorrencia,
  somarDias,
  unidadesSemAgenda,
  type AgendaBase,
} from './agendaGeral';

// 13/10/2026 é uma terça-feira.
const HOJE = '2026-10-13';

const agenda = (parcial: Partial<AgendaBase> & { id: string }): AgendaBase => ({
  soc: 'SP6',
  title: 'TRATATIVAS',
  training_type: 'TRATATIVAS',
  day_of_week: 2,
  start_time: '10:00',
  end_time: '11:00',
  instructor_name: 'YGOR MADUREIRA',
  location: 'SP6',
  is_recurring: false,
  specific_date: null,
  ...parcial,
});

const AGENDAS: AgendaBase[] = [
  agenda({ id: 'sp6-tratativas', soc: 'SP6', title: 'TRATATIVAS', specific_date: '2026-10-20' }),
  agenda({ id: 'sp8-checklist', soc: 'SP8', title: 'CHECK LIST LH', training_type: 'RECEBIMENTO', specific_date: '2026-11-22' }),
  agenda({ id: 'pe2-hoje', soc: 'PE2', title: 'SALVADOS', specific_date: HOJE, start_time: '13:30', end_time: '14:00' }),
  agenda({ id: 'mg2-passada', soc: 'MG2', title: 'AVARIA DE PRODUTOS', specific_date: '2026-10-08' }),
  agenda({ id: 'sp8-antiga', soc: 'SP8', title: 'FADDED', specific_date: '2026-09-23' }),
  // Recorrentes: toda quinta (4) e toda terça (2 — hoje).
  agenda({ id: 'rj4-semanal', soc: 'RJ4', title: 'EQUIPE DE TRATATIVAS', is_recurring: true, day_of_week: 4, start_time: '13:00' }),
  agenda({ id: 'sp8-semanal', soc: 'SP8', title: 'TRATATIVAS DE ROTINA', is_recurring: true, day_of_week: 2 }),
];

const SEM_INSCRITOS = new Map<string, number>();
const ids = (periodo: Parameters<typeof montarLinhas>[3]) => montarLinhas(AGENDAS, SEM_INSCRITOS, HOJE, periodo).map(l => l.id);

describe('agendaGeral — datas', () => {
  it('soma dias atravessando o mês sem escorregar de fuso', () => {
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('a próxima ocorrência conta o próprio dia e nunca volta no tempo', () => {
    expect(proximaOcorrencia(2, HOJE)).toBe('2026-10-13'); // terça, hoje
    expect(proximaOcorrencia(4, HOJE)).toBe('2026-10-15'); // quinta
    expect(proximaOcorrencia(1, HOJE)).toBe('2026-10-19'); // segunda que vem
    expect(proximaOcorrencia(0, HOJE)).toBe('2026-10-18'); // domingo
  });

  it('"Este mês" vai do dia 1 ao último dia', () => {
    expect(intervaloDoPeriodo('mes', HOJE)).toEqual({ de: '2026-10-01', ate: '2026-10-31' });
    expect(intervaloDoPeriodo('mes', '2026-02-10')).toEqual({ de: '2026-02-01', ate: '2026-02-28' });
  });
});

describe('agendaGeral — o que é recorrente', () => {
  it('só é "data marcada" quem tem is_recurring = false E uma data — igual ao calendário', () => {
    expect(ehRecorrente(agenda({ id: 'a', is_recurring: false, specific_date: '2026-10-20' }))).toBe(false);
    expect(ehRecorrente(agenda({ id: 'b', is_recurring: true, specific_date: null }))).toBe(true);
    // Sem data, o calendário desenha toda semana mesmo com is_recurring = false.
    expect(ehRecorrente(agenda({ id: 'c', is_recurring: false, specific_date: null }))).toBe(true);
    expect(ehRecorrente(agenda({ id: 'd', is_recurring: null, specific_date: null }))).toBe(true);
  });
});

describe('agendaGeral — a lista por período', () => {
  it('"Próximas": de hoje em diante, em ordem de data e horário — o exemplo do pedido', () => {
    const linhas = montarLinhas(AGENDAS, SEM_INSCRITOS, HOJE, 'proximas');
    expect(linhas.map(l => `${l.soc} ${l.data} ${l.tema}`)).toEqual([
      'SP8 2026-10-13 TRATATIVAS DE ROTINA',  // recorrente, toda terça — hoje, 10:00
      'PE2 2026-10-13 SALVADOS',              // hoje, 13:30
      'RJ4 2026-10-15 EQUIPE DE TRATATIVAS',  // recorrente, quinta
      'SP6 2026-10-20 TRATATIVAS',
      'SP8 2026-11-22 CHECK LIST LH',
    ]);
    expect(linhas[0]).toMatchObject({ ehHoje: true, recorrente: true, passada: false });
  });

  it('"Próximos 7 dias" corta o que está além — inclusive a recorrente que só cai depois', () => {
    expect(ids('7dias')).toEqual(['sp8-semanal', 'pe2-hoje', 'rj4-semanal', 'sp6-tratativas']);
    // Segunda que vem (19/10) cabe em 7 dias; em 5 não caberia.
    const segunda = [agenda({ id: 'seg', is_recurring: true, day_of_week: 1 })];
    expect(montarLinhas(segunda, SEM_INSCRITOS, HOJE, '7dias').map(l => l.data)).toEqual(['2026-10-19']);
  });

  it('"Este mês" inclui o que já passou no mês; a recorrente aparece na próxima ocorrência, não numa passada', () => {
    const linhas = montarLinhas(AGENDAS, SEM_INSCRITOS, HOJE, 'mes');
    expect(linhas.map(l => l.id)).toEqual(['mg2-passada', 'sp8-semanal', 'pe2-hoje', 'rj4-semanal', 'sp6-tratativas']);
    expect(linhas[0].passada).toBe(true);
  });

  it('"Já realizadas": só data marcada anterior a hoje, da mais recente para a mais antiga, sem recorrentes', () => {
    expect(ids('passadas')).toEqual(['mg2-passada', 'sp8-antiga']);
  });

  it('"Todas as datas" traz tudo, cada agenda uma vez só', () => {
    const todas = ids('todas');
    expect(todas).toHaveLength(AGENDAS.length);
    expect(new Set(todas).size).toBe(AGENDAS.length);
  });

  it('recorrente com dia da semana inválido fica de fora em vez de quebrar a lista', () => {
    const ruins = [agenda({ id: 'x', is_recurring: true, day_of_week: null }), agenda({ id: 'y', is_recurring: true, day_of_week: 9 })];
    expect(montarLinhas(ruins, SEM_INSCRITOS, HOJE, 'todas')).toEqual([]);
  });

  it('conta os inscritos da agenda NAQUELA data', () => {
    const inscritos = new Map([
      [chaveInscricao('sp6-tratativas', '2026-10-20'), 4],
      [chaveInscricao('sp8-semanal', '2026-10-13'), 2],
      [chaveInscricao('sp8-semanal', '2026-10-06'), 9], // semana passada: não entra na próxima ocorrência
    ]);
    const linhas = montarLinhas(AGENDAS, inscritos, HOJE, 'proximas');
    expect(linhas.find(l => l.id === 'sp6-tratativas')?.inscritos).toBe(4);
    expect(linhas.find(l => l.id === 'sp8-semanal')?.inscritos).toBe(2);
    expect(linhas.find(l => l.id === 'pe2-hoje')?.inscritos).toBe(0);
  });

  it('título com espaço sobrando e agenda sem unidade não quebram a exibição', () => {
    const [l] = montarLinhas([agenda({ id: 'z', soc: null, title: '  TRATATIVAS DE ROTINA ', specific_date: '2026-10-20' })], SEM_INSCRITOS, HOJE, 'todas');
    expect(l).toMatchObject({ soc: '(sem unidade)', tema: 'TRATATIVAS DE ROTINA' });
  });
});

describe('agendaGeral — por unidade', () => {
  const linhas = montarLinhas(AGENDAS, SEM_INSCRITOS, HOJE, 'proximas');

  it('agrupa por unidade em ordem natural (SP6 antes de SP8), mantendo a ordem de data dentro de cada uma', () => {
    const grupos = agruparPorUnidade(linhas);
    expect(grupos.map(g => g.soc)).toEqual(['PE2', 'RJ4', 'SP6', 'SP8']);
    expect(grupos[3].linhas.map(l => l.id)).toEqual(['sp8-semanal', 'sp8-checklist']);
  });

  it('aponta as unidades olhadas que não têm agenda nenhuma no período', () => {
    expect(unidadesSemAgenda(['SP6', 'SP8', 'SP10', 'SP2', 'BA2'], linhas)).toEqual(['BA2', 'SP2', 'SP10']);
  });
});

describe('agendaGeral — texto e exportação', () => {
  const linhas = montarLinhas(AGENDAS, SEM_INSCRITOS, HOJE, 'proximas');

  it('descreve quando: data marcada com o dia da semana; recorrente com a próxima ocorrência', () => {
    expect(descreverQuando(linhas.find(l => l.id === 'sp6-tratativas')!)).toBe('20/10/2026 (terça)');
    expect(descreverQuando(linhas.find(l => l.id === 'rj4-semanal')!)).toBe('Toda quinta · próxima 15/10/2026');
  });

  it('o CSV sai com ponto e vírgula, uma linha por agenda, e aspas no texto protegidas', () => {
    const csv = paraCsv(montarLinhas([agenda({ id: 'q', title: 'TREINO "A"', specific_date: '2026-10-20' })], SEM_INSCRITOS, HOJE, 'todas'));
    const [cabecalho, linha] = csv.split('\n');
    expect(cabecalho.startsWith('"Unidade";"Data";"Dia da semana"')).toBe(true);
    expect(linha).toContain('"SP6";"20/10/2026";"Terça";"10:00";"11:00";"TREINO ""A"""');
    expect(csv.split('\n')).toHaveLength(2);
  });
});
