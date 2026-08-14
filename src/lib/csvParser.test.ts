import { describe, it, expect } from 'vitest';
import {
  splitDelimitedLine,
  detectSeparator,
  normalizeHeaderText,
  parseDelimitedText,
  getField,
  parseBrDate,
  mapCollaboratorRow,
  mapLeaderRow,
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

// Casos extraídos da planilha real que causaram o incidente de 11/08/2026:
// campos entre aspas com quebra de linha dentro. A versão antiga do parser
// quebrava o texto por \n antes de olhar as aspas e destruía essas linhas.
describe('csvParser — campos com quebra de linha dentro de aspas (regressão do incidente)', () => {
  it('mantém a linha inteira quando o campo entre aspas tem \\n dentro', () => {
    const text = 'Colaborador,Ops ID,BPO,SOC\nMAYARA DOS SANTOS PAGINE,"Ops398312\n",GI Group,PR4';
    const { header, rows } = parseDelimitedText(text);
    expect(header).toEqual(['colaborador', 'ops id', 'bpo', 'soc']);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('MAYARA DOS SANTOS PAGINE');
    expect(rows[0][2]).toBe('GI Group');
    expect(rows[0][3]).toBe('PR4');
  });

  it('não deixa o nome absorver o resto da linha (o bug "Ops260982,SPX,AUXILIAR...")', () => {
    const text = 'Colaborador,Ops ID,BPO,Cargo,Desligado,SOC\n"\nFERNANDA GABRIELLE",Ops496065,RANDSTAD,AUXILIAR DE LOGISTICA,,SP6';
    const { rows } = parseDelimitedText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).not.toContain(',');
    expect(rows[0][1]).toBe('Ops496065');
  });

  it('trata aspas escapadas ("") como aspas literal, sem quebrar o campo', () => {
    const text = 'Colaborador,Setor\n"MARIA ""LETICIA"" MORAES",PROCESSAMENTO';
    const { rows } = parseDelimitedText(text);
    expect(rows[0][0]).toBe('MARIA "LETICIA" MORAES');
    expect(rows[0][1]).toBe('PROCESSAMENTO');
  });

  it('todas as linhas mantêm a mesma contagem de colunas do cabeçalho', () => {
    const text = [
      'Colaborador,Ops ID,SOC',
      'ANA SILVA,Ops1,SP6',
      'BRUNO "O" COSTA,"Ops2\n",SP5',
      'CARLA LIMA,Ops3,SP8',
    ].join('\n');
    const { header, rows } = parseDelimitedText(text);
    expect(rows).toHaveLength(3);
    rows.forEach(r => expect(r).toHaveLength(header.length));
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

describe('csvParser — mapLeaderRow', () => {
  it('mapeia as colunas do modelo de líderes', () => {
    const header = ['nome', 'e-mail', 'setor', 'atividade', 'turno', 'gestor', 'soc'];
    const cells = ['Maria Souza', 'Maria.Souza@Shopee.com', 'RECEBIMENTO', 'Docas LH', 'T3', 'Carlos Lima', 'sp06'];
    expect(mapLeaderRow(cells, header)).toEqual({
      name: 'Maria Souza',
      email: 'maria.souza@shopee.com', // e-mail sempre minúsculo: é a chave do vínculo com o time
      sector: 'RECEBIMENTO',
      activity: 'Docas LH',
      shift: 'T3',
      leader: 'Carlos Lima',
      soc: 'SP6',
    });
  });

  // O header chega aqui já normalizado por parseDelimitedText (sem acento,
  // minúsculo) — por isso o alias é 'lider' e não 'líder'.
  it('aceita "lider" como sinônimo de nome e campos ausentes viram vazio', () => {
    const row = mapLeaderRow(['Ana Paula'], ['lider']);
    expect(row.name).toBe('Ana Paula');
    expect(row.email).toBe('');
    expect(row.soc).toBe('');
  });
});
