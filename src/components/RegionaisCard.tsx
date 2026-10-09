import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Layers, Plus, Trash2, Edit2, Check, X, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { CHAVE_SOCS_REGIONAIS, useSocsERegionais, type Regional, type SocComRegional } from '@/lib/regionais';

/**
 * Regionais (Configurações) — admin e master. Agrupa as SOCs: "Regional 1"
 * com as de São Paulo metrópole, "Regional 2" com as do interior... O
 * agrupamento vira filtro na tela de Relatórios.
 *
 * Cada SOC fica em UMA regional (socs.regional_id): marcar uma SOC que já
 * está em outra regional a move — a tela avisa de onde ela sai. Apagar a
 * regional só solta as SOCs dela. Ver supabase/migrations/20261009_01.
 *
 * Quem barra a escrita é a RLS (regionais_escrita e admin_write_socs, as
 * duas para admin e master); aqui a tela só confere se o banco gravou tudo
 * o que foi pedido, porque a RLS recusa em silêncio — o UPDATE "dá certo" e
 * não altera linha nenhuma.
 */
export default function RegionaisCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useSocsERegionais();
  const regionais = useMemo(() => data?.regionais ?? [], [data]);
  const socs = useMemo(() => data?.socs ?? [], [data]);
  const semTabela = !!data?.semTabela;

  const [novoNome, setNovoNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [renomeando, setRenomeando] = useState<{ id: string; nome: string } | null>(null);
  const [atrelando, setAtrelando] = useState<{ id: string; marcadas: Set<string> } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const nomeDaRegional = useMemo(() => new Map(regionais.map(r => [r.id, r.nome])), [regionais]);
  const socsPorRegional = useMemo(() => {
    const mapa = new Map<string, SocComRegional[]>();
    for (const s of socs) {
      if (!s.regional_id) continue;
      const lista = mapa.get(s.regional_id) ?? [];
      lista.push(s);
      mapa.set(s.regional_id, lista);
    }
    return mapa;
  }, [socs]);
  const semRegional = useMemo(
    () => socs.filter(s => !s.regional_id || !nomeDaRegional.has(s.regional_id)),
    [socs, nomeDaRegional],
  );

  const recarregar = () => queryClient.invalidateQueries({ queryKey: CHAVE_SOCS_REGIONAIS });
  const limparNome = (nome: string) => nome.trim().replace(/\s+/g, ' ');
  const ehNomeRepetido = (e: { code?: string; message?: string }) =>
    e.code === '23505' || /duplicate key|idx_regionais_nome_unico/i.test(e.message ?? '');
  const mensagemDe = (e: unknown) =>
    e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);

  async function criarRegional() {
    const nome = limparNome(novoNome);
    if (!nome) { toast.error('Dê um nome para a regional.'); return; }
    setCriando(true);
    const { data: criada, error: erro } = await supabase
      .from('regionais')
      .insert({ nome })
      .select('id, nome')
      .single();
    setCriando(false);
    if (erro || !criada) {
      toast.error(erro && ehNomeRepetido(erro)
        ? `Já existe uma regional chamada "${nome}".`
        : 'Não consegui criar a regional: ' + (erro?.message ?? 'sem resposta do banco'));
      return;
    }
    setNovoNome('');
    toast.success(`Regional "${criada.nome}" criada. Agora marque as SOCs dela.`);
    await recarregar();
    // Já abre a lista de SOCs: criar a regional e não atrelar nada é o
    // passo que mais fica pela metade.
    setRenomeando(null);
    setAtrelando({ id: criada.id, marcadas: new Set() });
  }

  async function salvarNome() {
    if (!renomeando) return;
    const nome = limparNome(renomeando.nome);
    if (!nome) { toast.error('O nome não pode ficar vazio.'); return; }
    const { data: alteradas, error: erro } = await supabase
      .from('regionais')
      .update({ nome })
      .eq('id', renomeando.id)
      .select('id');
    if (erro) {
      toast.error(ehNomeRepetido(erro) ? `Já existe uma regional chamada "${nome}".` : 'Não consegui renomear: ' + erro.message);
      return;
    }
    if (!alteradas?.length) { toast.error('O banco não deixou renomear — só admin e master podem mexer em regionais.'); return; }
    toast.success('Regional renomeada.');
    setRenomeando(null);
    recarregar();
  }

  async function apagarRegional(r: Regional) {
    const daRegional = socsPorRegional.get(r.id) ?? [];
    const aviso = daRegional.length
      ? `\n\nAs ${daRegional.length} SOC(s) dela (${daRegional.map(s => s.name).join(', ')}) ficam sem regional. Nenhuma unidade é apagada.`
      : '';
    if (!confirm(`Apagar a regional "${r.nome}"?${aviso}`)) return;
    const { data: apagadas, error: erro } = await supabase.from('regionais').delete().eq('id', r.id).select('id');
    if (erro) { toast.error('Não consegui apagar: ' + erro.message); return; }
    if (!apagadas?.length) { toast.error('O banco não deixou apagar — só admin e master podem mexer em regionais.'); return; }
    toast.success(`Regional "${r.nome}" apagada.`);
    if (atrelando?.id === r.id) setAtrelando(null);
    recarregar();
  }

  function abrirAtrelar(r: Regional) {
    setRenomeando(null);
    setAtrelando({ id: r.id, marcadas: new Set((socsPorRegional.get(r.id) ?? []).map(s => s.id)) });
  }

  function alternar(socId: string) {
    setAtrelando(atual => {
      if (!atual) return atual;
      const marcadas = new Set(atual.marcadas);
      if (marcadas.has(socId)) marcadas.delete(socId);
      else marcadas.add(socId);
      return { ...atual, marcadas };
    });
  }

  function marcarSemRegional() {
    setAtrelando(atual => atual && {
      ...atual,
      marcadas: new Set([...atual.marcadas, ...semRegional.map(s => s.id)]),
    });
  }

  async function salvarAtrelar(r: Regional) {
    if (!atrelando) return;
    const atuais = new Set((socsPorRegional.get(r.id) ?? []).map(s => s.id));
    const adicionar = socs.filter(s => atrelando.marcadas.has(s.id) && !atuais.has(s.id));
    const remover = socs.filter(s => atuais.has(s.id) && !atrelando.marcadas.has(s.id));
    if (adicionar.length === 0 && remover.length === 0) { setAtrelando(null); return; }
    const movidas = adicionar.filter(s => s.regional_id && nomeDaRegional.has(s.regional_id));

    setSalvando(true);
    try {
      if (adicionar.length) {
        const { data: ok, error: erro } = await supabase
          .from('socs')
          .update({ regional_id: r.id })
          .in('id', adicionar.map(s => s.id))
          .select('id');
        if (erro) throw erro;
        if ((ok?.length ?? 0) < adicionar.length) throw new Error('o banco recusou parte das SOCs — só admin e master podem atrelar SOCs');
      }
      if (remover.length) {
        const { data: ok, error: erro } = await supabase
          .from('socs')
          .update({ regional_id: null })
          .in('id', remover.map(s => s.id))
          .eq('regional_id', r.id)
          .select('id');
        if (erro) throw erro;
        if ((ok?.length ?? 0) < remover.length) throw new Error('o banco recusou parte das SOCs — só admin e master podem soltar SOCs');
      }
      const partes: string[] = [];
      if (adicionar.length) partes.push(`${adicionar.map(s => s.name).join(', ')} entrou(aram)`);
      if (remover.length) partes.push(`${remover.map(s => s.name).join(', ')} saiu(íram)`);
      const mudancas = movidas.map(s => `${s.name} saiu de ${nomeDaRegional.get(s.regional_id as string)}`);
      toast.success(`${r.nome}: ${partes.join('; ')}.${mudancas.length ? ` (${mudancas.join('; ')})` : ''}`, { duration: 8000 });
      setAtrelando(null);
    } catch (e) {
      toast.error('Não consegui salvar as SOCs: ' + mensagemDe(e));
    } finally {
      setSalvando(false);
      recarregar();
    }
  }

  async function soltarSoc(s: SocComRegional, r: Regional) {
    const { data: ok, error: erro } = await supabase
      .from('socs')
      .update({ regional_id: null })
      .eq('id', s.id)
      .eq('regional_id', r.id)
      .select('id');
    if (erro) { toast.error('Não consegui tirar a SOC: ' + erro.message); return; }
    if (!ok?.length) { toast.error('O banco não deixou tirar a SOC — só admin e master podem mexer em regionais.'); return; }
    toast.success(`${s.name} saiu da ${r.nome}.`);
    setAtrelando(atual => {
      if (!atual || atual.id !== r.id) return atual;
      const marcadas = new Set(atual.marcadas);
      marcadas.delete(s.id);
      return { ...atual, marcadas };
    });
    recarregar();
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-8 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-gray-900" />
          <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight">Regionais</h2>
        </div>
        <p className="text-xs text-gray-400 font-medium mt-1">
          Agrupe as SOCs em regionais — por exemplo, Regional 1 com as unidades de São Paulo metrópole e Regional 2
          com as do interior. Vale para todas as unidades, não só a que está sendo gerenciada, e vira filtro na tela
          de Relatórios. Cada SOC fica em uma regional só: marcar uma SOC que já está em outra a move.
        </p>
      </div>

      <div className="p-8 space-y-6">
        {semTabela && (
          <p className="text-[11px] text-amber-700 font-bold bg-amber-50 border border-amber-100 rounded-xl p-3">
            As regionais ainda não existem no banco. Aplique a migração
            {' '}<code className="font-mono">20261009_01_regionais.sql</code> no SQL Editor do Supabase e recarregue a página.
          </p>
        )}
        {(error || data?.erroRegionais) && (
          <p className="text-[11px] text-red-600 font-bold bg-red-50 border border-red-100 rounded-xl p-3">
            Não consegui carregar as regionais: {error ? mensagemDe(error) : data?.erroRegionais}
          </p>
        )}

        <form
          onSubmit={e => { e.preventDefault(); criarRegional(); }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <input
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            placeholder="Nome da nova regional (ex.: Regional 1 — SP Metrópole)"
            maxLength={80}
            disabled={semTabela}
            className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 text-sm font-medium text-gray-700 outline-none focus:border-[#EE4D2D] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={criando || semTabela || !novoNome.trim()}
            className="shrink-0 flex items-center justify-center gap-2 px-6 py-3 rounded-xl shopee-gradient-bg text-white text-[11px] font-black uppercase tracking-widest hover:brightness-110 shadow-md disabled:opacity-50 transition-all"
          >
            <Plus size={14} />
            {criando ? 'Criando…' : 'Criar regional'}
          </button>
        </form>

        {isLoading && <p className="text-xs text-gray-400 font-medium">Carregando regionais…</p>}

        {regionais.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {regionais.map(r => {
              const daRegional = socsPorRegional.get(r.id) ?? [];
              const editandoNome = renomeando?.id === r.id;
              const painelAberto = atrelando?.id === r.id;
              return (
                <div key={r.id} className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    {editandoNome ? (
                      <form
                        onSubmit={e => { e.preventDefault(); salvarNome(); }}
                        className="flex items-center gap-1.5 flex-1 min-w-0"
                      >
                        <input
                          autoFocus
                          value={renomeando?.nome ?? ''}
                          onChange={e => setRenomeando({ id: r.id, nome: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Escape') setRenomeando(null); }}
                          maxLength={80}
                          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-bold text-gray-800 outline-none focus:border-[#EE4D2D]"
                        />
                        <button type="submit" title="Salvar o nome" className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-all">
                          <Check size={16} />
                        </button>
                        <button type="button" onClick={() => setRenomeando(null)} title="Cancelar" className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 transition-all">
                          <X size={16} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <div className="min-w-0">
                          <p className="text-sm font-black text-gray-900 break-words">{r.nome}</p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                            {daRegional.length === 1 ? '1 SOC' : `${daRegional.length} SOCs`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => { setAtrelando(null); setRenomeando({ id: r.id, nome: r.nome }); }}
                            title="Renomear"
                            className="p-2 rounded-lg text-gray-300 hover:text-[#EE4D2D] hover:bg-[#FEF6F5] transition-all"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => apagarRegional(r)}
                            title="Apagar a regional (as SOCs dela ficam sem regional)"
                            className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {daRegional.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {daRegional.map(s => (
                        <span key={s.id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-[#FEF6F5] text-[#EE4D2D] text-[10px] font-black border border-[#EE4D2D]/10">
                          {s.name}
                          <button
                            onClick={() => soltarSoc(s, r)}
                            title={`Tirar ${s.name} desta regional`}
                            className="p-0.5 rounded-full hover:bg-[#EE4D2D]/10 transition-colors"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400 font-medium">Nenhuma SOC atrelada ainda.</p>
                  )}

                  {painelAberto ? (
                    <div className="rounded-xl bg-white border border-gray-100 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Marque as SOCs desta regional</p>
                        {semRegional.length > 0 && (
                          <button type="button" onClick={marcarSemRegional} className="text-[10px] font-black text-[#EE4D2D] hover:underline">
                            + todas as sem regional
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                        {socs.map(s => {
                          const marcada = atrelando?.marcadas.has(s.id) ?? false;
                          const outra = s.regional_id && s.regional_id !== r.id ? nomeDaRegional.get(s.regional_id) : undefined;
                          return (
                            <label
                              key={s.id}
                              title={outra ? `Hoje em ${outra}. Marcar move a SOC para ${r.nome}.` : undefined}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                                marcada ? 'border-[#EE4D2D]/40 bg-[#FEF6F5]' : 'border-gray-100 hover:bg-gray-50'
                              }`}
                            >
                              <input type="checkbox" checked={marcada} onChange={() => alternar(s.id)} className="accent-[#EE4D2D] shrink-0" />
                              <span className="min-w-0">
                                <span className="block text-xs font-black text-gray-800">{s.name}</span>
                                {outra && (
                                  <span className="block text-[9px] font-bold text-amber-600 truncate">
                                    {marcada ? `sai de ${outra}` : `em ${outra}`}
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setAtrelando(null)}
                          className="px-4 py-2 rounded-lg text-[11px] font-black text-gray-500 hover:bg-gray-50 transition-all"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => salvarAtrelar(r)}
                          disabled={salvando}
                          className="px-5 py-2 rounded-lg shopee-gradient-bg text-white text-[11px] font-black uppercase tracking-widest hover:brightness-110 disabled:opacity-50 transition-all"
                        >
                          {salvando ? 'Salvando…' : 'Salvar'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => abrirAtrelar(r)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-gray-200 text-[11px] font-black text-gray-500 hover:border-[#EE4D2D]/40 hover:text-[#EE4D2D] hover:bg-white transition-all"
                    >
                      <Link2 size={13} />
                      Atrelar SOCs
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isLoading && !semTabela && regionais.length === 0 && (
          <div className="text-center py-8">
            <Layers size={36} className="mx-auto text-gray-100 mb-2" />
            <p className="text-xs text-gray-400 font-medium">Nenhuma regional criada ainda.</p>
          </div>
        )}

        {regionais.length > 0 && semRegional.length > 0 && (
          <div className="rounded-2xl border border-dashed border-gray-200 p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
              Sem regional ({semRegional.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {semRegional.map(s => (
                <span key={s.id} className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 text-[10px] font-black">
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
