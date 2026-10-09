import { describe, it, expect } from 'vitest';
import {
  chaveDoMicro,
  deduplicarMicros,
  desempenhoPorRegional,
  indexarMicrosPorSoc,
  regionaisAlcancaveis,
  SEM_REGIONAL,
  socsDaRegional,
} from './escopoRelatorios';

const REGIONAIS = [
  { id: 'r1', nome: 'Regional 1' },
  { id: 'r2', nome: 'Regional 2' },
  { id: 'r3', nome: 'Regional 3' }, // sem nenhuma SOC
];

const SOCS = [
  { name: 'SP10', regional_id: 'r1', has_sorting: false },
  { name: 'SP2', regional_id: 'r1', has_sorting: true },
  { name: 'SP6', regional_id: 'r1', has_sorting: false },
  { name: 'SP18', regional_id: 'r2', has_sorting: false },
  { name: 'SP35', regional_id: 'r2', has_sorting: false },
  { name: 'RJ2', regional_id: null, has_sorting: true },
];

describe('escopoRelatorios — SOCs de uma regional', () => {
  it('devolve as SOCs da regional em ordem natural (SP2 antes de SP10)', () => {
    expect(socsDaRegional('r1', SOCS)).toEqual(['SP2', 'SP6', 'SP10']);
  });

  it('corta as SOCs que o usuário não alcança', () => {
    const alcanca = (s: string) => ['SP6', 'SP18'].includes(s);
    expect(socsDaRegional('r1', SOCS, alcanca)).toEqual(['SP6']);
  });

  it('regional sem SOC alcançável fica fora do filtro', () => {
    const alcanca = (s: string) => s === 'SP18';
    expect(regionaisAlcancaveis(REGIONAIS, SOCS, alcanca).map(r => r.id)).toEqual(['r2']);
  });

  it('para quem alcança tudo, só some a regional que não tem SOC nenhuma', () => {
    expect(regionaisAlcancaveis(REGIONAIS, SOCS, () => true).map(r => r.id)).toEqual(['r1', 'r2']);
  });
});

describe('escopoRelatorios — micro-processos de várias unidades', () => {
  it('a chave ignora unidade, caixa, espaços e a grafia de EXPEDIÇÃO', () => {
    expect(chaveDoMicro('EXPEDICAO', ' Carregamento  de  Gaiolas ')).toBe(chaveDoMicro('Expedição', 'CARREGAMENTO DE GAIOLAS'));
    expect(chaveDoMicro('RECEBIMENTO', 'Descarga')).not.toBe(chaveDoMicro('EXPEDIÇÃO', 'Descarga'));
  });

  it('uma coluna por área + nome, mantendo o primeiro cadastro', () => {
    const micros = [
      { id: 'a', soc_name: 'SP6', macro_area: 'RECEBIMENTO', name: 'Descarga', is_mandatory: true },
      { id: 'b', soc_name: 'SP2', macro_area: 'RECEBIMENTO', name: 'DESCARGA', is_mandatory: false },
      { id: 'c', soc_name: 'SP2', macro_area: 'PROCESSAMENTO', name: 'Descarga', is_mandatory: true },
    ];
    expect(deduplicarMicros(micros).map(m => m.id)).toEqual(['a', 'c']);
  });

  it('o índice por unidade devolve o cadastro da unidade da pessoa, não o da coluna', () => {
    const micros = [
      { id: 'a', soc_name: 'SP6', macro_area: 'RECEBIMENTO', name: 'Descarga', is_mandatory: true },
      { id: 'b', soc_name: 'SP2', macro_area: 'RECEBIMENTO', name: 'DESCARGA', is_mandatory: false },
    ];
    const indice = indexarMicrosPorSoc(micros);
    const chave = chaveDoMicro('RECEBIMENTO', 'Descarga');
    expect(indice.get('SP6')?.get(chave)?.is_mandatory).toBe(true);
    expect(indice.get('SP2')?.get(chave)?.is_mandatory).toBe(false);
    // Unidade que não tem esse micro: sem cadastro, a célula não é cobrada.
    expect(indice.get('SP18')?.get(chave)).toBeUndefined();
  });
});

describe('escopoRelatorios — comparativo por regional', () => {
  it('o % é treinados ÷ HC da regional inteira, não a média dos % das SOCs', () => {
    const linhas = [
      { soc: 'SP2', total_hc: 1000, trained_hc: 900 }, // 90%
      { soc: 'SP6', total_hc: 100, trained_hc: 10 },   // 10%
    ];
    const [r1] = desempenhoPorRegional(linhas, SOCS, REGIONAIS);
    expect(r1).toMatchObject({ regional: 'Regional 1', socs: 2, total_hc: 1100, trained_hc: 910, pct: 82.7 });
  });

  it('SOC sem regional, ou com regional apagada, cai em "Sem regional"', () => {
    const socs = [...SOCS, { name: 'XX1', regional_id: 'apagada', has_sorting: false }];
    const linhas = [
      { soc: 'RJ2', total_hc: 50, trained_hc: 25 },
      { soc: 'XX1', total_hc: 50, trained_hc: 50 },
    ];
    const resultado = desempenhoPorRegional(linhas, socs, REGIONAIS);
    expect(resultado).toEqual([
      { regionalId: null, regional: SEM_REGIONAL, socs: 2, total_hc: 100, trained_hc: 75, pct: 75 },
    ]);
  });

  it('ordena do maior % para o menor', () => {
    const linhas = [
      { soc: 'SP2', total_hc: 10, trained_hc: 5 },
      { soc: 'SP18', total_hc: 10, trained_hc: 9 },
    ];
    expect(desempenhoPorRegional(linhas, SOCS, REGIONAIS).map(r => r.regional)).toEqual(['Regional 2', 'Regional 1']);
  });
});
