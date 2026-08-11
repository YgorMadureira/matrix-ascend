import { describe, it, expect } from 'vitest';
import {
  splitDelimitedLine,
  detectSeparator,
  normalizeHeaderText,
  parseDelimitedText,
  getField,
  parseBrDate,
  mapCollaboratorRow,
} from './csvParser';

describe('csvParser — splitDelimitedLine', () => {
  it('separa por vírgula respeitando aspas', () => {
    expect(splitDelimitedLine('a,b,c', ',')).toEqual(['a', 'b', 'c']);
    expect(splitDelimitedLine('"Silva, João",SP6,RECEBIMENTO', ',')).toEqual(['Silva, João', 'SP6', 'RECEBIMENTO']);
  });

  it('separa por ponto-e-vírgula quando esse é o separador', () => {
    expect(splitDelimitedLine('a;b;c', ';')).toEqual(['a', 'b', 'c']);
  });

  it('trata campos vazios entre delimitadores', () => {
    expect(splitDelimitedLine('a,,c', ',')).toEqual(['a', '', 'c']);
  });
});

describe('csvParser — detectSeparator', () => {
  it('detecta ; quando presente na primeira linha', () => {
    expect(detectSeparator('Nome;SOC;Setor')).toBe(';');
  });
  it('usa , como padrão', () => {
    expect(detectSeparator('Nome,SOC,Setor')).toBe(',');
  });
});

describe('csvParser — normalizeHeaderText', () => {
  it('remove acentos e baixa a caixa', () => {
    expect(normalizeHeaderText('Gênero')).toBe('genero');
    expect(normalizeHeaderText('Líder')).toBe('lider');
    expect(normalizeHeaderText('  Setor  ')).toBe('setor');
  });
});

describe('csvParser — parseDelimitedText', () => {
  it('separa cabeçalho normalizado e linhas de dados', () => {
    const text = 'Colaborador,SOC,Setor\nJoão Silva,SP6,RECEBIMENTO\nMaria Souza,SP5,PROCESSAMENTO';
    const { header, rows } = parseDelimitedText(text);
    expect(header).toEqual(['colaborador', 'soc', 'setor']);
    expect(rows).toEqual([
      ['João Silva', 'SP6', 'RECEBIMENTO'],
      ['Maria Souza', 'SP5', 'PROCESSAMENTO'],
    ]);
  });

  it('remove BOM do início do arquivo', () => {
    const text = '﻿Colaborador,SOC\nJoão,SP6';
    const { header } = parseDelimitedText(text);
    expect(header[0]).toBe('colaborador');
  });

  it('normaliza quebras de linha \\r\\n e ignora linhas em branco', () => {
    const text = 'Colaborador,SOC\r\nJoão,SP6\r\n\r\nMaria,SP5\r\n';
    const { rows } = parseDelimitedText(text);
    expect(rows).toHaveLength(2);
  });

  it('texto vazio devolve header e rows vazios', () => {
    expect(parseDelimitedText('')).toEqual({ header: [], rows: [] });
  });
});

describe('csvParser — getField', () => {
  const header = ['colaborador', 'soc', 'genero'];
  const cells = ['João Silva', 'SP6', 'M'];

  it('encontra pelo primeiro alias que existir no cabeçalho', () => {
    expect(getField(cells, header, ['nome', 'colaborador'])).toBe('João Silva');
  });

  it('tenta os aliases em ordem até achar um presente', () => {
    expect(getField(cells, header, ['unidade', 'soc'])).toBe('SP6');
  });

  it('devolve string vazia se nenhum alias existir', () => {
    expect(getField(cells, header, ['turno', 'shift'])).toBe('');
  });
});

describe('csvParser — parseBrDate', () => {
  it('converte dd/mm/yyyy para yyyy-mm-dd', () => {
    expect(parseBrDate('05/03/2026')).toBe('2026-03-05');
  });
  it('preenche zero à esquerda em dia/mês de um dígito', () => {
    expect(parseBrDate('5/3/2026')).toBe('2026-03-05');
  });
  it('devolve null para datas inválidas ou formato errado', () => {
    expect(parseBrDate('não é data')).toBeNull();
    expect(parseBrDate('2026-03-05')).toBeNull(); // já em ISO, sem "/"
    expect(parseBrDate('')).toBeNull();
  });
});

describe('csvParser — mapCollaboratorRow', () => {
  it('mapeia todas as colunas pelos aliases conhecidos', () => {
    const header = ['colaborador', 'genero', 'cargo', 'soc', 'ops id', 'bpo', 'turno', 'setor', 'lider', 'atividade', 'data de admissao'];
    const cells = ['João Silva', 'M', 'AUXILIAR', 'sp06', '12345', 'Foco', 'T1', 'RECEBIMENTO', 'Maria Souza', 'CONFERENCIA', '05/03/2026'];
    const row = mapCollaboratorRow(cells, header);
    expect(row).toEqual({
      name: 'João Silva',
      gender: 'M',
      role: 'AUXILIAR',
      soc: 'SP6', // sp06 -> maiúsculo e zero interno removido
      opsid: '12345',
      bpo: 'Foco',
      shift: 'T1',
      sector: 'RECEBIMENTO',
      leader: 'Maria Souza',
      activity: 'CONFERENCIA',
      admission_date: '2026-03-05',
    });
  });

  it('campos ausentes viram string vazia (ou null para a data)', () => {
    const header = ['colaborador'];
    const cells = ['João Silva'];
    const row = mapCollaboratorRow(cells, header);
    expect(row.soc).toBe('');
    expect(row.opsid).toBe('');
    expect(row.admission_date).toBeNull();
  });
});
