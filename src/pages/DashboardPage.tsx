import { useAuth } from '@/contexts/AuthContext';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { BarChart2, Users, CheckCircle2, Percent, Trophy, Medal, Award, AlertCircle } from 'lucide-react';
import {
  calculateSocHealth,
  calculateUnitStats,
  type CollaboratorLite,
  type MicroTraining,
  type SocHealthResult,
} from '@/lib/trainingRules';
import { filterTeamOfLeader } from '@/lib/leaderTeam';

/** Estado inicial da saúde, enquanto os dados não chegaram. Fora do componente para ter identidade estável entre renders. */
const VAZIO_SAUDE: SocHealthResult = { eligible: false, microCount: 0, minRequired: 14, missing: 14, evaluatedCollaborators: 0, healthPct: 0 };

/** Onboardings administrativos: valem para o time inteiro, não por setor. */
const TRANSVERSAL_SECTORS = ['HSE', 'PEOPLE'] as const;

interface SectorStat { sector: string; total: number; trained: number; pct: number }
interface SocRank extends SocHealthResult { soc: string; totalCollaborators: number }
interface CollabRow {
  id: string; sector: string; leader: string; soc: string; role: string;
  /** Usados para resolver "Meu Time" pelo vínculo de líder — ver src/lib/leaderTeam.ts. */
  email?: string | null; is_leader?: boolean; leader_id?: string | null;
}
interface TrainingRow { collaborator_id: string; training_type: string }

// ── Nível de saúde (cores SUTIS, sem glow/pulse) ───────────────
const getLevel = (pct: number) => {
  if (pct >= 98) return {
    name: 'Modelo', emoji: '🏆',
    cardBg:    'bg-green-50',
    cardBorder:'border-green-300',
    titleText: 'text-green-700',
    subText:   'text-green-500',
    barBg:     'bg-green-100',
    barFg:     'bg-green-500',
    badgeBg:   'bg-green-100 text-green-700 border-green-300',
    iconBg:    'bg-green-100',
    iconBorder:'border-green-300',
  };
  if (pct >= 95) return {
    name: 'Ouro', emoji: '🥇',
    cardBg:    'bg-yellow-50',
    cardBorder:'border-yellow-300',
    titleText: 'text-yellow-700',
    subText:   'text-yellow-600',
    barBg:     'bg-yellow-100',
    barFg:     'bg-yellow-500',
    badgeBg:   'bg-yellow-100 text-yellow-700 border-yellow-300',
    iconBg:    'bg-yellow-100',
    iconBorder:'border-yellow-300',
  };
  if (pct >= 80) return {
    name: 'Prata', emoji: '🥈',
    cardBg:    'bg-slate-50',
    cardBorder:'border-slate-300',
    titleText: 'text-slate-600',
    subText:   'text-slate-400',
    barBg:     'bg-slate-200',
    barFg:     'bg-slate-400',
    badgeBg:   'bg-slate-100 text-slate-600 border-slate-300',
    iconBg:    'bg-slate-100',
    iconBorder:'border-slate-300',
  };
  if (pct >= 70) return {
    name: 'Bronze', emoji: '🥉',
    cardBg:    'bg-amber-50',
    cardBorder:'border-amber-400',
    titleText: 'text-amber-800',
    subText:   'text-amber-600',
    barBg:     'bg-amber-100',
    barFg:     'bg-amber-600',
    badgeBg:   'bg-amber-100 text-amber-800 border-amber-400',
    iconBg:    'bg-amber-100',
    iconBorder:'border-amber-400',
  };
  return {
    name: 'Crítico', emoji: '⚠️',
    cardBg:    'bg-red-50',
    cardBorder:'border-red-300',
    titleText: 'text-red-600',
    subText:   'text-red-400',
    barBg:     'bg-red-100',
    barFg:     'bg-red-400',
    badgeBg:   'bg-red-100 text-red-600 border-red-300',
    iconBg:    'bg-red-100',
    iconBorder:'border-red-300',
  };
};

// ── Pódio ─────────────────────────────────────────────────────
const PODIUM_CONFIG = [
  { rank: 2, label: '2° Lugar', height: 'h-20', Icon: Medal,  iconColor: 'text-slate-400', cardBorder: 'border-slate-200', rankBg: 'bg-slate-300 text-slate-700', top: 'mt-10' },
  { rank: 1, label: '1° Lugar', height: 'h-28', Icon: Trophy, iconColor: 'text-amber-400', cardBorder: 'border-amber-200', rankBg: 'bg-amber-400 text-white',      top: 'mt-0'  },
  { rank: 3, label: '3° Lugar', height: 'h-14', Icon: Award,  iconColor: 'text-amber-700', cardBorder: 'border-amber-300', rankBg: 'bg-amber-700 text-white',      top: 'mt-16' },
];

export default function DashboardPage() {
  const { profile, isLider, socHasSorting, effectiveSoc } = useAuth();
  const navigate = useNavigate();

  // Filtra ASM quando a SOC não possui sorting
  const showAsm = socHasSorting !== false;

  // ============================================================
  // Busca dos dados brutos — separada do cálculo de propósito.
  //
  // Antes isto era um useEffect que baixava tudo em DUAS paginações
  // sequenciais: 21 requisições de colaboradores + 31 de treinamentos, cada
  // uma esperando a anterior. São ~56 idas e voltas em fila; numa conexão
  // com 150ms de latência isso sozinho passa de 8 segundos, mesmo o banco
  // respondendo rápido. Pior: o efeito dependia de effectiveSoc, então cada
  // troca de unidade no seletor do topo refazia as 56 requisições, e nada
  // era reaproveitado ao voltar para a tela.
  //
  // Agora as páginas saem TODAS em paralelo (duas ondas, não 56 esperas) e o
  // resultado fica no cache do React Query. Trocar de unidade ou revisitar a
  // tela passa a recalcular em memória, sem tocar na rede.
  // ============================================================
  const { data: bruto, isLoading } = useQuery({
    queryKey: ['dashboard-base'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const LIMITE = 1000;

      // Contagens primeiro, para saber quantas páginas pedir de uma vez.
      const [cCollabs, cTrainings, cMaterials] = await Promise.all([
        supabase.from('collaborators').select('id', { count: 'exact', head: true }),
        supabase.from('trainings_completed').select('id', { count: 'exact', head: true }),
        supabase.from('materials').select('id', { count: 'exact', head: true }),
      ]);

      // +1 página de margem: entre a contagem e a busca alguém pode ter
      // inserido linhas. A página extra volta vazia quando não há nada.
      // O .order('id') não é enfeite: sem ordenação estável, chamadas range()
      // concorrentes podem repetir ou pular linhas.
      const paginas = (total: number | null) => Math.ceil((total ?? 0) / LIMITE) + 1;

      const [porCollab, porTraining, micros, socsData] = await Promise.all([
        Promise.all(Array.from({ length: paginas(cCollabs.count) }, (_, i) =>
          supabase.from('collaborators')
            .select('id, sector, leader, role, soc, email, is_leader, leader_id')
            .order('id').range(i * LIMITE, (i + 1) * LIMITE - 1)
        )),
        Promise.all(Array.from({ length: paginas(cTrainings.count) }, (_, i) =>
          supabase.from('trainings_completed')
            .select('collaborator_id, training_type')
            .order('id').range(i * LIMITE, (i + 1) * LIMITE - 1)
        )),
        supabase.from('soc_micro_trainings').select('soc_name, macro_area, name'),
        supabase.from('socs').select('name, has_sorting'),
      ]);

      return {
        allCollabs:     porCollab.flatMap(r => (r.data ?? []) as CollabRow[]),
        allTrainings:   porTraining.flatMap(r => (r.data ?? []) as TrainingRow[]),
        allMicros:      (micros.data ?? []) as { soc_name: string; macro_area: string; name: string }[],
        socsData:       (socsData.data ?? []) as { name: string; has_sorting: boolean | null }[],
        materialsCount: cMaterials.count ?? 0,
        trainingsCount: cTrainings.count ?? 0,
      };
    },
  });

  // ============================================================
  // Cálculo — puro, em memória. Depende do usuário e da unidade em foco,
  // então roda de novo ao trocar de unidade, mas sem tocar na rede.
  // ============================================================
  const { stats, health, sectorStats, socRanking } = useMemo(() => {
    if (!bruto) {
      return {
        stats: { collaborators: 0, materials: 0, trainings: 0, trainedPct: 0, trainedCount: 0 },
        health: VAZIO_SAUDE,
        sectorStats: [] as SectorStat[],
        socRanking: [] as SocRank[],
      };
    }

    const { allCollabs, allTrainings, allMicros, socsData, materialsCount, trainingsCount } = bruto;

    const microsBySoc = new Map<string, MicroTraining[]>();
    allMicros.forEach(m => {
      const arr = microsBySoc.get(m.soc_name) || [];
      arr.push({ name: m.name, macro_area: m.macro_area });
      microsBySoc.set(m.soc_name, arr);
    });
    const sortingBySoc = new Map<string, boolean>(socsData.map(s => [s.name, !!s.has_sorting]));

    const trainingsByCollabId = new Map<string, string[]>();
    allTrainings.forEach(t => {
      const arr = trainingsByCollabId.get(t.collaborator_id) || [];
      arr.push(t.training_type || '');
      trainingsByCollabId.set(t.collaborator_id, arr);
    });

    // ── Meu Time ────────────────────────────────────────────
    // O time do líder sai do vínculo já resolvido no banco (leader_id), com
    // o casamento por texto só como rede — ver src/lib/leaderTeam.ts.
    const userSoc = effectiveSoc || '';
    const socCollabs = userSoc ? allCollabs.filter(c => c.soc === userSoc) : allCollabs;
    const collabs    = isLider ? filterTeamOfLeader(socCollabs, profile) : socCollabs;
    const totalCollabs = collabs.length;

    const socHealth = calculateSocHealth(
      microsBySoc.get(userSoc) || [], collabs as CollaboratorLite[], trainingsByCollabId, showAsm
    );

    // O mesmo unitStats alimenta o card "% Treinados" E os quadros de
    // macro-setor logo abaixo. Antes eram duas contas diferentes na mesma
    // tela: o card dizia 460 treinados e os quadros somavam 466.
    const unit = calculateUnitStats(collabs as CollaboratorLite[], trainingsByCollabId, showAsm);

    // HSE e PEOPLE são onboardings administrativos: transversais, avaliados
    // sobre o time inteiro, não por setor.
    const trainingsByCollabUpper = new Map<string, string[]>();
    trainingsByCollabId.forEach((types, id) => trainingsByCollabUpper.set(id, types.map(t => t.toUpperCase())));

    const transversais: SectorStat[] = TRANSVERSAL_SECTORS.map(sector => {
      const trained = collabs.filter(c =>
        (trainingsByCollabUpper.get(c.id) || []).some(t => t.includes('ONBOARDING') && t.includes(sector))
      ).length;
      return { sector, total: totalCollabs, trained, pct: totalCollabs > 0 ? Math.round((trained / totalCollabs) * 100) : 0 };
    });

    // ── Ranking de saúde: todas as unidades ─────────────────
    const socGroups = new Map<string, CollabRow[]>();
    allCollabs.forEach(c => { if (!c.soc) return; const a = socGroups.get(c.soc) || []; a.push(c); socGroups.set(c.soc, a); });

    const ranking: SocRank[] = [];
    socGroups.forEach((list, soc) => {
      const result = calculateSocHealth(
        microsBySoc.get(soc) || [], list as CollaboratorLite[], trainingsByCollabId, sortingBySoc.get(soc) ?? false
      );
      ranking.push({ soc, totalCollaborators: list.length, ...result });
    });

    // Desempate: 1º saúde desc, 2º nº de colaboradores desc, 3º sigla (estável).
    ranking.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (a.eligible && b.eligible) {
        if (b.healthPct !== a.healthPct) return b.healthPct - a.healthPct;
        if (b.totalCollaborators !== a.totalCollaborators) return b.totalCollaborators - a.totalCollaborators;
        return a.soc.localeCompare(b.soc);
      }
      // Entre as não elegíveis: quem está mais perto de qualificar aparece primeiro.
      if (a.missing !== b.missing) return a.missing - b.missing;
      return b.totalCollaborators - a.totalCollaborators;
    });

    return {
      stats: {
        collaborators: totalCollabs,
        materials:     materialsCount,
        trainings:     isLider ? unit.trained : trainingsCount,
        trainedPct:    unit.pct,
        trainedCount:  unit.trained,
      },
      health: socHealth,
      sectorStats: [
        ...unit.byArea.map(a => ({ sector: a.area, total: a.total, trained: a.trained, pct: Math.round(a.pct) })),
        ...transversais,
      ],
      socRanking: ranking,
    };
    // `profile` inteiro (e não só full_name/leader_key) porque filterTeamOfLeader
    // também usa o e-mail para achar a linha do líder.
  }, [bruto, effectiveSoc, isLider, profile, showAsm]);

  const loading = isLoading;

  const level = getLevel(health.healthPct);

  // O "hint" existe para deixar o denominador à mostra: a dúvida que gerou a
  // padronização de 13/08/2026 foi justamente não dar para saber, olhando o
  // card, sobre quantas pessoas o percentual estava sendo calculado.
  const cards = [
    { label: 'Meu Time',    value: stats.collaborators,    hint: 'pessoas na unidade',                                 icon: Users,        color: 'text-[#EE4D2D]',   iconBg: 'bg-[#FEF6F5]' },
    { label: '% Treinados', value: `${stats.trainedPct}%`, hint: `${stats.trainedCount} de ${stats.collaborators}`,    icon: Percent,      color: 'text-emerald-600', iconBg: 'bg-emerald-50' },
    { label: 'Materiais',   value: stats.materials,        hint: '',                                                   icon: BarChart2,    color: 'text-[#EE4D2D]',   iconBg: 'bg-[#FEF6F5]' },
    { label: 'Treinados',   value: stats.trainedCount,     hint: 'todos os setores',                                   icon: CheckCircle2, color: 'text-amber-500',   iconBg: 'bg-amber-50' },
  ];

  const eligibleRanking = socRanking.filter(s => s.eligible);
  const top3 = eligibleRanking.slice(0, 3);
  // Ordem do pódio: 2° | 1° | 3°
  const podiumOrder = [top3[1], top3[0], top3[2]];

  // Régua de marcos — posições ajustadas para não sobrepor rótulos nas pontas
  const RULER = [
    { label: 'Crítico', pct:  1, color: 'text-red-400',    align: 'start'  as const },
    { label: 'Bronze',  pct: 70, color: 'text-amber-600',  align: 'center' as const },
    { label: 'Prata',   pct: 80, color: 'text-slate-500',  align: 'center' as const },
    { label: 'Ouro',    pct: 95, color: 'text-yellow-500', align: 'center' as const },
    { label: 'Modelo',  pct: 99, color: 'text-green-500',  align: 'end'    as const },
  ];

  return (
    <div className="space-y-6">

      {/* ── Cabeçalho ───────────────────────────────────────── */}
      <div className="bg-white/50 p-5 rounded-xl border border-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">
            Bem-vindo, <span className="text-[#EE4D2D]">{profile?.full_name}</span>
          </h1>
          <p className="text-xs text-gray-400 font-medium mt-0.5">Shopee • Painel de Gestão Operacional</p>
        </div>
        <div className="flex items-center gap-2 bg-[#FEF6F5] px-3 py-1.5 rounded-full border border-[#EE4D2D]/10">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[9px] font-bold text-[#EE4D2D] uppercase tracking-wider">Sistema Online • v2.4</span>
        </div>
      </div>

      {/* ── Card de Nível de Saúde (sutil) ──────────────────── */}
      <div className={`rounded-xl border-2 p-5 ${level.cardBg} ${level.cardBorder} transition-colors duration-700`}>
        <div className="flex flex-col md:flex-row md:items-center gap-6">

          {/* Esquerda: ícone + nível + contagem */}
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className={`w-16 h-16 rounded-xl border-2 ${level.iconBorder} ${level.iconBg} flex items-center justify-center text-3xl`}>
              {level.emoji}
            </div>
            <div>
              <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${level.subText}`}>
                {userSocLabel(effectiveSoc)} Nível de Saúde
              </p>
              <p className={`text-3xl font-black ${level.titleText}`}>{level.name}</p>
              <p className={`text-[10px] font-medium mt-1 ${level.subText}`}>
                {health.eligible
                  ? `Média individual sobre os ${health.microCount} treinamentos específicos cadastrados (Recebimento, Processamento, Expedição${showAsm ? ' e ASM' : ''})`
                  : `Faltam ${health.missing} processo${health.missing !== 1 ? 's' : ''} micro${health.missing !== 1 ? 's' : ''} para medir a saúde de ${effectiveSoc || 'sua unidade'} (mínimo de 14)`}
              </p>
            </div>
          </div>

          {/* Direita: % + barra + régua, OU aviso de cadastro pendente */}
          <div className="flex-1 min-w-0">
            {health.eligible ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-black uppercase tracking-widest ${level.subText}`}>Índice de Saúde</span>
                  <span className={`text-2xl font-black ${level.titleText}`}>{health.healthPct}%</span>
                </div>

                {/* Barra de progresso */}
                <div className={`h-2.5 w-full rounded-full overflow-hidden ${level.barBg}`}>
                  <div
                    className={`h-full rounded-full ${level.barFg} transition-all duration-1000`}
                    style={{ width: `${Math.min(health.healthPct, 100)}%` }}
                  />
                </div>

                {/* Régua de níveis */}
                <div className="relative mt-2 h-6">
                  {RULER.map(m => (
                    <div
                      key={m.label}
                      className="absolute flex flex-col items-center"
                      style={{
                        left: `${m.pct}%`,
                        transform: m.align === 'start' ? 'translateX(0)' : m.align === 'end' ? 'translateX(-100%)' : 'translateX(-50%)',
                      }}
                    >
                      <div className={`w-px h-2 ${level.barBg}`} />
                      <span className={`text-[8px] font-black ${m.color} leading-none whitespace-nowrap`}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <button
                onClick={() => navigate('/settings')}
                className="w-full flex items-center gap-3 p-4 rounded-lg bg-white/70 border border-dashed border-amber-300 hover:bg-white transition-colors text-left"
              >
                <AlertCircle size={22} className="text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-gray-800">
                    {health.microCount} de 14 processos micros cadastrados
                  </p>
                  <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                    Cadastre mais {health.missing} em Configurações → Processos Micros para começar a medir a saúde desta unidade.
                  </p>
                </div>
                <span className="text-[10px] font-black text-[#EE4D2D] uppercase tracking-widest shrink-0">Ir →</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Cards de estatísticas ────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, hint, icon: Icon, color, iconBg }) => (
          <div key={label} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2.5 rounded-lg ${iconBg}`}>
                <Icon size={20} className={color} />
              </div>
              <span className="text-2xl font-black text-gray-900">{value}</span>
            </div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
            {hint && <p className="text-[9px] font-medium text-gray-300 mt-0.5">{hint}</p>}
          </div>
        ))}
      </div>

      {/* ── Desempenho por Macro-Setor ───────────────────────── */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-black text-gray-900">Desempenho por Macro-Setor</h2>
            <p className="text-[10px] text-gray-400 font-medium mt-0.5">Visão consolidada de certificações por área</p>
          </div>
          <button onClick={() => navigate('/reports')} className="text-[10px] font-black text-[#EE4D2D] uppercase tracking-widest hover:underline transition-all">
            Ver Detalhes →
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {sectorStats.map(s => (
            <div key={s.sector} onClick={() => navigate('/reports')}
              className="bg-gray-50 border border-transparent hover:border-[#EE4D2D]/20 hover:bg-white p-4 rounded-xl text-center transition-all group cursor-pointer shadow-sm hover:shadow-md">
              <p className="text-[9px] font-black text-gray-400 mb-2 uppercase tracking-tighter line-clamp-1">{s.sector}</p>
              <p className={`text-xl font-black transition-colors ${s.pct > 0 ? 'text-gray-900 group-hover:text-[#EE4D2D]' : 'text-gray-300 group-hover:text-[#EE4D2D]'}`}>{s.pct}%</p>
              <p className="text-[8px] text-gray-400 font-bold mt-1">{s.trained}/{s.total} treinados</p>
              <div className="w-full h-1 bg-gray-200 mt-3 rounded-full overflow-hidden">
                <div className="h-full bg-[#EE4D2D] rounded-full transition-all duration-500" style={{ width: `${s.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Ranking de Saúde dos SOCs — todas as unidades ──────── */}
      {!loading && socRanking.length > 0 && (
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <div className="mb-6">
            <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
              <Trophy size={17} className="text-amber-400" />
              Ranking de Saúde dos SOCs
            </h2>
            <p className="text-[10px] text-gray-400 font-medium mt-0.5">
              {eligibleRanking.length} de {socRanking.length} unidades com matriz de processos micros completa (mínimo 14)
            </p>
          </div>

          {/* Pódio visual — só entre as elegíveis */}
          {eligibleRanking.length >= 2 ? (
            <div className="flex items-end justify-center gap-4 pt-4 pb-2">
              {podiumOrder.map((socData, i) => {
                const pos = PODIUM_CONFIG[i];
                if (!socData) return <div key={i} className="w-36" />;
                const lv = getLevel(socData.healthPct);
                return (
                  <div key={socData.soc} className={`flex flex-col items-center gap-2 ${pos.top}`}>
                    <div className={`w-36 rounded-xl border ${pos.cardBorder} bg-white p-4 text-center shadow-sm`}>
                      <div className="text-2xl mb-1">{lv.emoji}</div>
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{pos.label}</p>
                      <p className="text-base font-black text-gray-900 mt-0.5">{socData.soc}</p>
                      <p className={`text-xl font-black mt-1 ${lv.titleText}`}>{socData.healthPct}%</p>
                      <span className={`inline-block mt-1 text-[8px] font-black px-2 py-0.5 rounded-full border ${lv.badgeBg}`}>{lv.name}</span>
                      <p className="text-[8px] text-gray-400 font-bold mt-2">{socData.evaluatedCollaborators}/{socData.totalCollaborators}</p>
                    </div>
                    <div className={`w-36 ${pos.height} ${pos.rankBg} rounded-t-lg flex items-center justify-center font-black text-xl`}>
                      {pos.rank}°
                    </div>
                  </div>
                );
              })}
            </div>
          ) : eligibleRanking.length === 1 ? (
            <div className="flex justify-center pt-2 pb-4">
              <div className="w-40 rounded-xl border border-amber-200 bg-white p-4 text-center shadow-sm">
                <div className="text-2xl mb-1">{getLevel(eligibleRanking[0].healthPct).emoji}</div>
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">1° Lugar (única elegível)</p>
                <p className="text-base font-black text-gray-900 mt-0.5">{eligibleRanking[0].soc}</p>
                <p className={`text-xl font-black mt-1 ${getLevel(eligibleRanking[0].healthPct).titleText}`}>{eligibleRanking[0].healthPct}%</p>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-gray-400 text-xs font-medium">
              Nenhuma unidade cadastrou os 14 processos micros mínimos ainda.
            </div>
          )}

          {/* Ranking completo — todas as SOCs, elegíveis primeiro */}
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Ranking Completo</p>
            <div className="space-y-1.5">
              {socRanking.map((s, idx) => {
                if (!s.eligible) {
                  return (
                    <div key={s.soc} className="flex items-center gap-3 py-1.5 px-3 rounded-lg bg-gray-50/50">
                      <span className="text-[11px] font-black text-gray-300 w-6 text-right">—</span>
                      <span className="text-sm opacity-40">🔒</span>
                      <span className="text-[12px] font-black text-gray-500 flex-1">{s.soc}</span>
                      <span className="text-[8px] font-black px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-600">
                        matriz incompleta • faltam {s.missing}
                      </span>
                      <span className="text-[11px] font-bold w-16 text-right text-gray-300">{s.totalCollaborators} HC</span>
                    </div>
                  );
                }
                const lv = getLevel(s.healthPct);
                const rankPos = eligibleRanking.findIndex(r => r.soc === s.soc) + 1;
                return (
                  <div key={s.soc} className="flex items-center gap-3 py-1.5 px-3 rounded-lg hover:bg-gray-50 transition-colors">
                    <span className="text-[11px] font-black text-gray-400 w-6 text-right">{rankPos}°</span>
                    <span className="text-sm">{lv.emoji}</span>
                    <span className="text-[12px] font-black text-gray-800 flex-1">{s.soc}</span>
                    <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${lv.badgeBg}`}>{lv.name}</span>
                    <div className={`w-24 h-1.5 rounded-full overflow-hidden ${lv.barBg}`}>
                      <div className={`h-full rounded-full ${lv.barFg}`} style={{ width: `${s.healthPct}%` }} />
                    </div>
                    <span className={`text-[11px] font-black w-10 text-right ${lv.titleText}`}>{s.healthPct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function userSocLabel(soc?: string | null) {
  return soc ? `SOC ${soc} • ` : '';
}
