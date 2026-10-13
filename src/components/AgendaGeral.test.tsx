import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// 13/10/2026 (terça) — a tela decide "próximas" e "hoje" pela data do relógio.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
});
afterAll(() => vi.useRealTimers());

const AGENDAS = [
  { id: 'a1', soc: 'SP6', title: 'TRATATIVAS', training_type: 'TRATATIVAS', day_of_week: 2, start_time: '10:00', end_time: '11:00', instructor_name: 'YGOR MADUREIRA', location: 'SP6', is_recurring: false, specific_date: '2026-10-20' },
  { id: 'a2', soc: 'SP8', title: 'CHECK LIST LH', training_type: 'RECEBIMENTO', day_of_week: 0, start_time: '09:00', end_time: '10:00', instructor_name: 'THAIS', location: 'SP8', is_recurring: false, specific_date: '2026-11-22' },
  { id: 'a3', soc: 'SP8', title: 'SALVADOS', training_type: 'TRATATIVAS', day_of_week: 1, start_time: '15:00', end_time: '16:00', instructor_name: 'MARÍLIA FERIOLI', location: 'SP8', is_recurring: true, specific_date: null },
  { id: 'a4', soc: 'MG2', title: 'AVARIA DE PRODUTOS', training_type: 'TRATATIVAS', day_of_week: 4, start_time: '08:00', end_time: '09:00', instructor_name: 'LORENA', location: 'MG2', is_recurring: false, specific_date: '2026-10-08' },
];
const INSCRICOES = [
  { schedule_id: 'a1', scheduled_date: '2026-10-20' },
  { schedule_id: 'a1', scheduled_date: '2026-10-20' },
];

// Construtor de consulta de mentira: devolve a tabela pedida, paginada como o PostgREST.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const linhas: unknown[] = tabela === 'training_schedules' ? AGENDAS : tabela === 'training_schedule_enrollments' ? INSCRICOES : [];
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        range: (de: number, ate: number) => Promise.resolve({ data: linhas.slice(de, ate + 1), error: null }),
      };
      return q;
    },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isMaster: true, allowedSocs: [] }) }));
vi.mock('@/lib/regionais', () => ({
  useSocsERegionais: () => ({
    data: {
      regionais: [{ id: 'r1', nome: 'REGIONAL 1' }],
      socs: [
        { id: 's1', name: 'SP6', has_sorting: false, regional_id: 'r1' },
        { id: 's2', name: 'SP8', has_sorting: true, regional_id: 'r1' },
        { id: 's3', name: 'MG2', has_sorting: true, regional_id: null },
        { id: 's4', name: 'BA2', has_sorting: false, regional_id: null },
      ],
      semTabela: false,
      erroRegionais: null,
    },
  }),
}));

import AgendaGeral from './AgendaGeral';

async function abrir() {
  const tela = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgendaGeral />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText(/Carregando as agendas/)).toBeNull());
  return tela;
}

const linhasDaLista = (container: HTMLElement) =>
  [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent ?? '');

describe('AgendaGeral', () => {
  it('lista as próximas agendas de todas as unidades, em ordem de data — o exemplo do pedido', async () => {
    const { container } = await abrir();
    const linhas = linhasDaLista(container);
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toContain('SP8');
    expect(linhas[0]).toContain('19/10/2026'); // recorrente de segunda: a próxima ocorrência
    expect(linhas[0]).toContain('Toda segunda');
    expect(linhas[1]).toContain('SP6');
    expect(linhas[1]).toContain('20/10/2026');
    expect(linhas[1]).toContain('TRATATIVAS');
    expect(linhas[2]).toContain('22/11/2026');
    expect(linhas[2]).toContain('CHECK LIST LH');
    // A de MG2 já passou (08/10): fica fora das próximas.
    expect(linhas.join(' ')).not.toContain('AVARIA DE PRODUTOS');
  });

  it('conta os inscritos da agenda e aponta as unidades sem agenda no período', async () => {
    const { container } = await abrir();
    expect(linhasDaLista(container)[1]).toMatch(/2$/); // SP6, 20/10: duas inscrições
    const aviso = screen.getByText(/Sem agenda no período \(2\)/).closest('div') as HTMLElement;
    expect(within(aviso).getByText('BA2')).toBeInTheDocument();
    expect(within(aviso).getByText('MG2')).toBeInTheDocument();
  });

  it('"Já realizadas" troca a lista para o que passou', async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'passadas' } });
    const linhas = linhasDaLista(container);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('MG2');
    expect(linhas[0]).toContain('08/10/2026');
  });

  it('filtrar por regional restringe as unidades olhadas e a lista', async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText('Regional'), { target: { value: 'r1' } });
    expect(linhasDaLista(container)).toHaveLength(3); // SP6 e SP8 são da regional
    // BA2 e MG2 não são da regional: saem do "sem agenda".
    expect(screen.queryByText(/Sem agenda no período/)).toBeNull();
    expect(screen.getByText('de 2')).toBeInTheDocument();
  });

  it('"Por unidade" agrupa com um cabeçalho por unidade', async () => {
    const { container } = await abrir();
    fireEvent.click(screen.getByText('Por unidade'));
    const linhas = linhasDaLista(container);
    expect(linhas[0]).toContain('SP6');
    expect(linhas[0]).toContain('1 agenda');
    expect(linhas[2]).toContain('SP8');
    expect(linhas[2]).toContain('2 agendas');
    expect(linhas).toHaveLength(5); // 2 cabeçalhos + 3 agendas
  });

  it('a busca acha pelo tema', async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByPlaceholderText(/Buscar tema/), { target: { value: 'check list' } });
    const linhas = linhasDaLista(container);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('CHECK LIST LH');
  });
});
