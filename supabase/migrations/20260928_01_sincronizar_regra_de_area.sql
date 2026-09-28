-- ============================================================
-- "Sincronizar" na tela de regras de área: mostrar o impacto na hora
-- ============================================================
-- Pedido de 28/09/2026: depois do caso do RJ2 (Onboarding PTS V3 → ASM), o
-- master quer clicar num botão "Sincronizar" ao criar/remover uma regra e
-- ver quantos colaboradores mudaram de status — em vez de confiar que
-- "deve ter atualizado em algum lugar".
--
-- ⚠️ NÃO EXISTE RECÁLCULO PENDENTE: as views collaborators_status e
-- soc_performance_view já fazem JOIN em training_area_rules (20260925_01) e
-- recalculam is_trained a cada consulta. No instante em que a regra existe
-- no banco, todo mundo que ela credencia já aparece treinado — foi assim que
-- o RJ2 saltou de 1.302 para 1.492 certificados na hora, sem nenhum passo
-- manual. "Sincronizar" aqui não é uma tarefa que recalcula algo atrasado —
-- é a MEDIÇÃO do efeito que a regra já teve, para dar a confirmação visível
-- que o master pediu.
--
-- Esta função conta, direto no banco, quantos colaboradores assinaram um
-- treinamento e ainda estão pendentes — sem trazer a lista de ids para o
-- navegador (um treinamento popular como "Onboarding PTS V3" tem 16 mil
-- assinaturas). A tela chama duas vezes: antes de criar a regra e depois,
-- e a diferença é o número que aparece no aviso de sucesso.
--
-- Idempotente: seguro rodar mais de uma vez.
-- ============================================================

create or replace function public.count_pending_signers(p_training_name text)
returns integer
language sql
stable
as $$
  select count(distinct cs.id)::int
  from public.collaborators_status cs
  join public.trainings_completed tc on tc.collaborator_id = cs.id
  where upper(btrim(tc.training_type)) = upper(btrim(p_training_name))
    and not cs.is_trained;
$$;

comment on function public.count_pending_signers(text) is
  'Quantos colaboradores assinaram este treinamento e continuam pendentes. Usada pela tela de Configurações para mostrar o impacto de criar/remover uma regra em training_area_rules (chamada antes e depois; a diferença é o número exibido).';

grant execute on function public.count_pending_signers(text) to authenticated;

-- ── Conferência ──────────────────────────────────────────────
-- "Onboarding PTS V3" tem uma regra (RJ2, 25/09/2026) cobrindo ASM. O
-- esperado aqui NÃO é 0: gente de Tratativas com só esse treinamento
-- continua pendente — nenhuma regra de ASM afeta Tratativas. É o número que
-- a tela mostraria como "antes" se alguém tentasse configurar OUTRA regra
-- para este mesmo treinamento agora (medido em 28/09/2026: 141).
select
  '✅ count_pending_signers criada.' as status,
  public.count_pending_signers('ONBOARDING PTS V3') as pendentes_com_onboarding_pts_v3_hoje;
