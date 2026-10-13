import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarDays, CalendarOff, Download, RefreshCw, Repeat, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSocsERegionais } from '@/lib/regionais';
import { regionaisAlcancaveis, socsDaRegional } from '@/lib/escopoRelatorios';
import {
  DIAS_DA_SEMANA,
  PERIODOS,
  agruparPorUnidade,
  chaveInscricao,
  compararUnidades,
  formatarData,
  montarLinhas,
  paraCsv,
  paraISO,
  unidadesSemAgenda,
  type AgendaBase,
  type LinhaAgenda,
  type Periodo,
} from '@/lib/agendaGeral';

/**
 * Visão geral da Agenda — a lista das agendas de TODAS as unidades que o
 * usuário enxerga, uma linha por agenda: "SP6 · 20/10 · Tratativas".
 *
 * Diferente do calendário ao lado, NÃO segue a unidade escolhida no topo da
 * tela: o ponto é olhar a rede inteira de uma vez. Quem decide o que cada
 * um vê é a RLS de training_schedules (o master vê tudo; os demais, as
 * unidades deles) — por isso a aba só aparece para quem enxerga mais de uma.
 *
 * A carga é só leitura e as contas ficam em src/lib/agendaGeral.ts.
 */

const PAGINA = 1000;

interface Inscricao { schedule_id: string; scheduled_date: string; }

/** Lê uma tabela inteira, página a página — o PostgREST corta em 1.000 linhas sem avisar. */
async function todasAsPaginas<T>(montar: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await montar(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as T[];
    tudo.push(...linhas);
    if (linhas.length < PAGINA) return tudo;
  }
}

async function carregarAgendaGeral(): Promise<{ agendas: AgendaBase[]; inscricoes: Inscricao[] }> {
  const [agendas, inscricoes] = await Promise.all([
    todasAsPaginas<AgendaBase>((de, ate) =>
      supabase
        .from('training_schedules')
        .select('id, soc, title, training_type, day_of_week, start_time, end_time, instructor_name, location, is_recurring, specific_date')
        .eq('is_active', true)
        .order('id')
        .range(de, ate)),
    todasAsPaginas<Inscricao>((de, ate) =>
      supabase
        .from('training_schedule_enrollments')
        .select('schedule_id, scheduled_date')
        .order('id')
        .range(de, ate)),
  ]);
  return { agendas, inscricoes };
}

const COR_DA_AREA: Record<string, string> = {
  RECEBIMENTO: 'bg-[#ECF2FD] text-[#1A50BE]',
  PROCESSAMENTO: 'bg-[#F1FBF1] text-[#1B8A23]',
  'EXPEDIÇÃO': 'bg-[#FEF6E4] text-[#C2832B]',
  TRATATIVAS: 'bg-[#F8F3FD] text-[#8C70BA]',
  ASM: 'bg-slate-100 text-slate-600',
};

export default function AgendaGeral() {
  const { isMaster, allowedSocs } = useAuth();
  const { data: socsERegionais } = useSocsERegionais();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['agenda-geral'],
    queryFn: carregarAgendaGeral,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [periodo, setPeriodo] = useState<Periodo>('proximas');
  const [regionalId, setRegionalId] = useState('');
  const [socEscolhida, setSocEscolhida] = useState('');
  const [areaEscolhida, setAreaEscolhida] = useState('');
  const [busca, setBusca] = useState('');
  const [porUnidade, setPorUnidade] = useState(false);

  const hoje = paraISO(new Date());

  // ── As unidades olhadas ──────────────────────────────────────
  // Master: todas as cadastradas. Demais: as que ele alcança. É contra esta
  // lista que se diz "sem agenda no período".
  const alcanca = useMemo(() => {
    const dele = new Set(allowedSocs);
    return (soc: string) => isMaster || dele.has(soc);
  }, [isMaster, allowedSocs]);

  const regionais = useMemo(
    () => socsERegionais ? regionaisAlcancaveis(socsERegionais.regionais, socsERegionais.socs, alcanca) : [],
    [socsERegionais, alcanca],
  );
  const regionalAtiva = regionais.find(r => r.id === regionalId);

  const unidades = useMemo(() => {
    const cadastradas = isMaster ? (socsERegionais?.socs ?? []).map(s => s.name) : allowedSocs;
    const daRegional = regionalAtiva && socsERegionais ? new Set(socsDaRegional(regionalAtiva.id, socsERegionais.socs, alcanca)) : null;
    return cadastradas.filter(s => !daRegional || daRegional.has(s)).sort(compararUnidades);
  }, [isMaster, socsERegionais, allowedSocs, regionalAtiva, alcanca]);

  // ── A lista ──────────────────────────────────────────────────
  const inscritosPor = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const i of data?.inscricoes ?? []) {
      const chave = chaveInscricao(i.schedule_id, i.scheduled_date);
      mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
    }
    return mapa;
  }, [data]);

  const doPeriodo = useMemo(
    () => montarLinhas(data?.agendas ?? [], inscritosPor, hoje, periodo),
    [data, inscritosPor, hoje, periodo],
  );

  /** Período + regional + unidade — a base do "sem agenda" e das opções de área. */
  const doEscopo = useMemo(() => {
    const daRegional = regionalAtiva ? new Set(unidades) : null;
    return doPeriodo.filter(l => {
      if (daRegional && !daRegional.has(l.soc)) return false;
      if (socEscolhida && l.soc !== socEscolhida) return false;
      return true;
    });
  }, [doPeriodo, regionalAtiva, unidades, socEscolhida]);

  const areas = useMemo(() => [...new Set(doEscopo.map(l => l.area).filter(Boolean))].sort(), [doEscopo]);

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return doEscopo.filter(l => {
      if (areaEscolhida && l.area !== areaEscolhida) return false;
      if (termo && !`${l.tema} ${l.instrutor} ${l.local} ${l.soc}`.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [doEscopo, areaEscolhida, busca]);

  const unidadesOlhadas = socEscolhida ? [socEscolhida] : unidades;
  // "Sem agenda" ignora a busca e o filtro de área: a pergunta é se a
  // unidade tem ALGUMA agenda no período, não se tem uma daquele tema.
  const semAgenda = useMemo(() => unidadesSemAgenda(unidadesOlhadas, doEscopo), [unidadesOlhadas, doEscopo]);
  const comAgenda = new Set(linhas.map(l => l.soc)).size;
  const totalInscritos = linhas.reduce((soma, l) => soma + l.inscritos, 0);
  const grupos = useMemo(() => (porUnidade ? agruparPorUnidade(linhas) : []), [porUnidade, linhas]);

  const exportar = () => {
    if (linhas.length === 0) { toast.error('Não há agendas na lista para exportar.'); return; }
    // BOM: sem ele o Excel abre o arquivo com os acentos trocados.
    const blob = new Blob([String.fromCharCode(0xFEFF) + paraCsv(linhas)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agenda_das_unidades_${formatarData(hoje).replace(/\//g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`${linhas.length} agenda(s) exportada(s).`);
  };

  const seletor = 'h-9 px-3 rounded-xl bg-white border border-gray-200 text-[11px] font-black text-gray-700 outline-none shadow-sm focus:border-[#EE4D2D]';

  const linhaDaTabela = (l: LinhaAgenda, mostrarUnidade: boolean) => (
    <tr key={l.id} className={`border-b border-gray-100 hover:bg-[#FEF6F5]/60 transition-colors ${l.passada ? 'opacity-60' : ''}`}>
      {mostrarUnidade && (
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="px-2.5 py-1 rounded-full bg-gray-900 text-white text-[10px] font-black tracking-wider">{l.soc}</span>
        </td>
      )}
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-black text-gray-900">{formatarData(l.data)}</span>
          {l.ehHoje && <span className="px-1.5 py-0.5 rounded bg-[#EE4D2D] text-white text-[9px] font-black uppercase">Hoje</span>}
        </div>
        <span className="text-[10px] text-gray-400 font-bold uppercase">
          {l.recorrente ? (
            <span className="inline-flex items-center gap-1 text-[#EE4D2D]" title="Agenda recorrente: acontece toda semana. A data é a da próxima ocorrência.">
              <Repeat size={10} /> Toda {DIAS_DA_SEMANA[l.diaDaSemana].toLowerCase()}
            </span>
          ) : DIAS_DA_SEMANA[l.diaDaSemana]}
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-[12px] font-bold text-gray-600">{l.inicio}{l.fim && ` – ${l.fim}`}</td>
      <td className="px-4 py-3 min-w-[220px]">
        <span className="text-[13px] font-black text-gray-900">{l.tema}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {l.area && (
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tight ${COR_DA_AREA[l.area] ?? 'bg-gray-100 text-gray-600'}`}>{l.area}</span>
        )}
      </td>
      <td className="px-4 py-3 text-[11px] font-bold text-gray-600">{l.instrutor || <span className="text-gray-300">—</span>}</td>
      <td className="px-4 py-3 text-[11px] font-bold text-gray-500 whitespace-nowrap">{l.local || <span className="text-gray-300">—</span>}</td>
      <td className="px-4 py-3 text-center whitespace-nowrap">
        <span className={`text-[12px] font-black ${l.inscritos > 0 ? 'text-gray-900' : 'text-gray-300'}`}>{l.inscritos}</span>
      </td>
    </tr>
  );

  const cabecalho = (mostrarUnidade: boolean) => (
    <thead className="sticky top-0 z-10">
      <tr className="bg-gray-50 border-b border-gray-200 text-left text-[9px] font-black text-gray-400 uppercase tracking-widest">
        {mostrarUnidade && <th className="px-4 py-3">Unidade</th>}
        <th className="px-4 py-3">Data</th>
        <th className="px-4 py-3">Horário</th>
        <th className="px-4 py-3">Tema</th>
        <th className="px-4 py-3">Área</th>
        <th className="px-4 py-3">Instrutor</th>
        <th className="px-4 py-3">Local</th>
        <th className="px-4 py-3 text-center">Inscritos</th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-black text-gray-900 text-sm flex items-center gap-2">
              <CalendarDays size={15} className="text-[#EE4D2D]" /> Agenda de todas as unidades
            </h2>
            <p className="text-[10px] text-gray-400 font-medium mt-0.5">
              {isMaster ? 'Todas as unidades' : 'As suas unidades'}, uma linha por agenda — não depende da unidade escolhida no topo da tela.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              title="Buscar de novo as agendas no banco"
              className="h-9 px-3 flex items-center gap-1.5 text-[11px] font-black text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 shadow-sm disabled:opacity-60 transition-colors"
            >
              <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Atualizar
            </button>
            <button
              onClick={exportar}
              title="Baixar a lista filtrada em CSV (abre no Excel)"
              className="h-9 px-3 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-white bg-[#EE4D2D] hover:bg-[#d63b1f] rounded-xl shadow-sm transition-colors"
            >
              <Download size={13} /> Exportar
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select value={periodo} onChange={e => setPeriodo(e.target.value as Periodo)} className={seletor} aria-label="Período">
            {PERIODOS.map(p => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
          </select>
          {regionais.length > 0 && (
            <select
              value={regionalAtiva?.id ?? ''}
              onChange={e => { setRegionalId(e.target.value); setSocEscolhida(''); }}
              className={seletor}
              aria-label="Regional"
            >
              <option value="">Todas as regionais</option>
              {regionais.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </select>
          )}
          <select value={socEscolhida} onChange={e => setSocEscolhida(e.target.value)} className={seletor} aria-label="Unidade">
            <option value="">Todas as unidades</option>
            {unidades.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={areaEscolhida} onChange={e => setAreaEscolhida(e.target.value)} className={seletor} aria-label="Área">
            <option value="">Todas as áreas</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar tema, instrutor ou local…"
              className="w-full h-9 pl-8 pr-3 rounded-xl bg-white border border-gray-200 text-[11px] font-bold text-gray-700 outline-none shadow-sm focus:border-[#EE4D2D]"
            />
          </div>
          <div className="flex items-center bg-gray-100 rounded-xl p-0.5" role="group" aria-label="Ordenar a lista">
            {([false, true] as const).map(v => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setPorUnidade(v)}
                aria-pressed={porUnidade === v}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                  porUnidade === v ? 'bg-white text-[#EE4D2D] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {v ? 'Por unidade' : 'Por data'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#FEF6F5] text-[#EE4D2D]"><CalendarDays size={18} /></div>
          <div>
            <p className="text-2xl font-black text-gray-900 leading-none">{linhas.length}</p>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-1">{linhas.length === 1 ? 'Agenda' : 'Agendas'}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gray-100 text-gray-700"><Building2 size={18} /></div>
          <div>
            <p className="text-2xl font-black text-gray-900 leading-none">
              {comAgenda}<span className="text-sm text-gray-300 font-black"> de {unidadesOlhadas.length}</span>
            </p>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-1">Unidades com agenda</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600"><Users size={18} /></div>
          <div>
            <p className="text-2xl font-black text-gray-900 leading-none">{totalInscritos}</p>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-1">Pessoas inscritas</p>
          </div>
        </div>
      </div>

      {/* Quem não tem agenda nenhuma no período — o que a lista, sozinha, esconde. */}
      {!isLoading && !error && semAgenda.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-1.5">
            <CalendarOff size={12} /> Sem agenda no período ({semAgenda.length})
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {semAgenda.map(s => (
              <span key={s} className="px-2.5 py-1 rounded-full bg-white border border-amber-200 text-amber-700 text-[10px] font-black">{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error ? (
          <p className="p-10 text-center text-sm font-bold text-red-500">
            Não consegui carregar as agendas: {(error as Error).message}
          </p>
        ) : isLoading ? (
          <p className="p-10 text-center text-xs font-bold text-gray-400 flex items-center justify-center gap-2">
            <RefreshCw size={13} className="animate-spin" /> Carregando as agendas de todas as unidades…
          </p>
        ) : linhas.length === 0 ? (
          <div className="p-12 text-center">
            <CalendarOff size={36} className="mx-auto text-gray-200 mb-2" />
            <p className="text-sm font-black text-gray-500">Nenhuma agenda com esses filtros.</p>
            <p className="text-[11px] text-gray-400 font-medium mt-1">Troque o período ou limpe a busca.</p>
          </div>
        ) : porUnidade ? (
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto custom-scrollbar">
            <table className="w-full border-collapse">
              {cabecalho(false)}
              {grupos.map(g => (
                <tbody key={g.soc}>
                  <tr className="bg-gray-900">
                    <td colSpan={7} className="px-4 py-2 text-white">
                      <span className="text-[12px] font-black tracking-widest">{g.soc}</span>
                      <span className="text-[10px] font-bold text-white/60 ml-2">{g.linhas.length === 1 ? '1 agenda' : `${g.linhas.length} agendas`}</span>
                    </td>
                  </tr>
                  {g.linhas.map(l => linhaDaTabela(l, false))}
                </tbody>
              ))}
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto custom-scrollbar">
            <table className="w-full border-collapse">
              {cabecalho(true)}
              <tbody>{linhas.map(l => linhaDaTabela(l, true))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
