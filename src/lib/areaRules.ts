// Carrega as regras de área configuradas na tela (tabela training_area_rules)
// para dentro do motor de regras.
//
// O motor (src/lib/trainingRules.ts) é feito de funções puras — ele não sabe
// consultar banco. Quem busca as regras é este arquivo, e quem manda usá-las
// é definirRegrasDeArea(). As telas que calculam em TypeScript (Dashboard e
// Relatórios) precisam chamar carregarRegrasDeArea() ANTES de calcular,
// senão a primeira renderização sai sem as regras e o número pisca errado.
//
// A tela de Colaboradores não precisa: ela lê is_trained da view
// collaborators_status, e o banco já aplica as mesmas regras pelo join em
// training_area_rules (ver a migração 20260925_01).

import { supabase } from '@/lib/supabase';
import { definirRegrasDeArea } from '@/lib/trainingRules';

/**
 * Busca as regras e as entrega ao motor. Nunca lança: se a consulta falhar
 * (tabela ainda não criada, rede), o sistema segue com as regras embutidas —
 * que é o comportamento de antes desta funcionalidade existir, e não uma
 * tela quebrada.
 */
export async function carregarRegrasDeArea(): Promise<void> {
  const { data, error } = await supabase
    .from('training_area_rules')
    .select('training_name, area');

  if (error) {
    console.error('[regras de área] não consegui carregar, seguindo só com as regras embutidas:', error.message);
    return;
  }
  definirRegrasDeArea(data ?? []);
}
