import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SocsERegionais } from '@/lib/regionais';

// Sem banco: o cartão lê tudo de useSocsERegionais, e o cliente do Supabase
// nem chega a ser criado.
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

let dados: SocsERegionais;
vi.mock('@/lib/regionais', () => ({
  CHAVE_SOCS_REGIONAIS: ['socs-regionais'],
  useSocsERegionais: () => ({ data: dados, isLoading: false, error: null }),
}));

import RegionaisCard from './RegionaisCard';

function renderizar() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RegionaisCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  dados = {
    regionais: [
      { id: 'r1', nome: 'Regional 1 — SP Metrópole' },
      { id: 'r2', nome: 'Regional 2 — SP Interior' },
    ],
    socs: [
      { id: 's2', name: 'SP2', has_sorting: true, regional_id: 'r1' },
      { id: 's6', name: 'SP6', has_sorting: false, regional_id: 'r1' },
      { id: 's18', name: 'SP18', has_sorting: false, regional_id: 'r2' },
      { id: 'rj2', name: 'RJ2', has_sorting: true, regional_id: null },
    ],
    semTabela: false,
    erroRegionais: null,
  };
});

describe('RegionaisCard', () => {
  it('mostra cada regional com as SOCs dela e lista as que estão sem regional', () => {
    renderizar();
    const r1 = screen.getByText('Regional 1 — SP Metrópole').closest('div.rounded-2xl') as HTMLElement;
    expect(within(r1).getByText('SP2')).toBeInTheDocument();
    expect(within(r1).getByText('SP6')).toBeInTheDocument();
    expect(within(r1).queryByText('SP18')).not.toBeInTheDocument();
    expect(within(r1).getByText('2 SOCs')).toBeInTheDocument();

    expect(screen.getByText('Sem regional (1)')).toBeInTheDocument();
    expect(screen.getByText('RJ2')).toBeInTheDocument();
  });

  it('o painel de atrelar marca as SOCs da regional e avisa de onde uma SOC vai sair', () => {
    renderizar();
    const r1 = screen.getByText('Regional 1 — SP Metrópole').closest('div.rounded-2xl') as HTMLElement;
    fireEvent.click(within(r1).getByText('Atrelar SOCs'));

    const caixa = (soc: string) =>
      within(r1).getAllByRole('checkbox').find(c => c.closest('label')?.textContent?.startsWith(soc)) as HTMLInputElement;
    expect(caixa('SP2').checked).toBe(true);
    expect(caixa('SP6').checked).toBe(true);
    expect(caixa('SP18').checked).toBe(false);
    expect(within(r1).getByText('em Regional 2 — SP Interior')).toBeInTheDocument();

    // Marcar SP18 avisa que ela sai da Regional 2.
    fireEvent.click(caixa('SP18'));
    expect(within(r1).getByText('sai de Regional 2 — SP Interior')).toBeInTheDocument();
  });

  it('"+ todas as sem regional" marca só as soltas', () => {
    renderizar();
    const r2 = screen.getByText('Regional 2 — SP Interior').closest('div.rounded-2xl') as HTMLElement;
    fireEvent.click(within(r2).getByText('Atrelar SOCs'));
    fireEvent.click(within(r2).getByText('+ todas as sem regional'));
    const marcadas = within(r2).getAllByRole('checkbox')
      .filter(c => (c as HTMLInputElement).checked)
      .map(c => c.closest('label')?.querySelector('span span')?.textContent);
    expect(marcadas.sort()).toEqual(['RJ2', 'SP18']);
  });

  it('sem a migração aplicada, avisa e não deixa criar', () => {
    dados = { regionais: [], socs: dados.socs, semTabela: true, erroRegionais: null };
    renderizar();
    expect(screen.getByText(/20261009_01_regionais\.sql/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Criar regional/ })).toBeDisabled();
  });
});
