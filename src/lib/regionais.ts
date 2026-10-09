// ============================================================
// Regionais — carga compartilhada por Configurações e Relatórios.
//
// Uma consulta só para as duas telas (chave CHAVE_SOCS_REGIONAIS no React
// Query): o cartão de Regionais invalida essa chave a cada mudança, e o
// filtro dos Relatórios enxerga a regional nova sem recarregar a página.
// As contas em cima destas listas ficam em src/lib/escopoRelatorios.ts.
// ============================================================
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { compararNomes, type RegionalBase, type SocBase } from './escopoRelatorios';

export type Regional = RegionalBase;

export interface SocComRegional extends SocBase {
  id: string;
  name: string;
  has_sorting: boolean | null;
  regional_id: string | null;
}

export interface SocsERegionais {
  regionais: Regional[];
  socs: SocComRegional[];
  /** A migração 20261009_01 ainda não foi aplicada: a tabela de regionais não existe. */
  semTabela: boolean;
  /** Outro erro ao ler as regionais (rede, permissão). As SOCs continuam valendo. */
  erroRegionais: string | null;
}

export const CHAVE_SOCS_REGIONAIS = ['socs-regionais'] as const;

/** A tabela não existe ainda? O PostgREST responde PGRST205 (cache de schema) ou 42P01. */
export function ehTabelaInexistente(erro: { code?: string; message?: string } | null | undefined): boolean {
  if (!erro) return false;
  if (erro.code === '42P01' || erro.code === 'PGRST205') return true;
  const msg = erro.message ?? '';
  return /regionais/i.test(msg) && /does not exist|could not find|schema cache/i.test(msg);
}

export async function carregarSocsERegionais(): Promise<SocsERegionais> {
  const [rRegionais, rSocs] = await Promise.all([
    supabase.from('regionais').select('id, nome'),
    // '*' de propósito: antes da migração, socs não tem regional_id, e pedir
    // a coluna pelo nome derrubaria a consulta inteira — e com ela a regra
    // de sorter por unidade que os Relatórios tiram daqui.
    supabase.from('socs').select('*'),
  ]);
  if (rSocs.error) throw new Error(rSocs.error.message);

  const semTabela = ehTabelaInexistente(rRegionais.error);
  // Erro nas regionais não derruba as SOCs: sem regionais, o filtro some e
  // o resto das telas segue como antes.
  const erroRegionais = rRegionais.error && !semTabela ? rRegionais.error.message : null;
  if (erroRegionais) console.warn('[Regionais] Não consegui ler as regionais:', erroRegionais);

  const regionais = ((rRegionais.error ? [] : rRegionais.data ?? []) as Regional[])
    .slice()
    .sort((a, b) => compararNomes(a.nome, b.nome));

  const socs = ((rSocs.data ?? []) as Record<string, unknown>[])
    .map(s => ({
      id: s.id as string,
      name: s.name as string,
      has_sorting: (s.has_sorting as boolean | null) ?? null,
      regional_id: (s.regional_id as string | null | undefined) ?? null,
    }))
    .filter(s => !!s.name)
    .sort((a, b) => compararNomes(a.name, b.name));

  return { regionais, socs, semTabela, erroRegionais };
}

export function useSocsERegionais(enabled = true) {
  return useQuery({
    queryKey: CHAVE_SOCS_REGIONAIS,
    queryFn: carregarSocsERegionais,
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
