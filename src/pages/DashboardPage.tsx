import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { BarChart2, Users, CheckCircle2, Percent, Trophy, Medal, Award } from 'lucide-react';

const SECTORS = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'TRATATIVAS', 'HSE', 'PEOPLE'] as const;
const CORE_TYPES = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'EXPEDICAO', 'TRATATIVAS', 'ASM'];

interface SectorStat  { sector: string; total: number; trained: number; pct: number }
interface SocRank     { soc: string;   total: number; trained: number; pct: number }
interface HealthState { pct: number; completed: number; total: number }

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

// ── Verifica conclusão de micro-treinamento (mesma lógica do ReportsPage) ──
const checkMicroCompleted = (
  collabId: string,
  microName: string,
  macroArea: string,
  trainingsMap: Map<string, string[]>
): boolean => {
  const types = trainingsMap.get(collabId) || [];
  const macro = macroArea.toUpperCase();
  const req   = microName.toUpperCase();
  const isCore = macro === 'RECEBIMENTO' || macro === 'PROCESSAMENTO' || macro === 'EXPEDIÇÃO' || macro === 'EXPEDICAO';

  return types.some(tType => {
    // Onboarding PTS (ou qualquer Onboarding) valida todas as 3 áreas core
    if (tType.includes('ONBOARDING PTS') && isCore) return true;
    if (tType.includes('ONBOARDING')     && isCore) return true;

    // Treinamento Padrão SOC por área
    const isPadrao = tType.includes('PADRÃO SOC') || tType.includes('PADRAO SOC') || tType.includes('TREINAMENTO PADRÃO') || tType.includes('TREINAMENTO PADRAO');
    
    if (isPadrao && tType.includes('RECEBIMENTO')   && (macro === 'RECEBIMENTO'   || req.includes('RECEBIMENTO')))   return true;
    if (isPadrao && tType.includes('PROCESSAMENTO') && (macro === 'PROCESSAMENTO' || req.includes('PROCESSAMENTO'))) return true;
    if (isPadrao && (tType.includes('EXPEDIÇÃO') || tType.includes('EXPEDICAO')) && (macro === 'EXPEDIÇÃO' || macro === 'EXPEDICAO' || req.includes('EXPEDIÇ') || req.includes('EXPEDIC'))) return true;

    // Match direto pelo nome exato do treinamento
    return tType === req || tType.includes(req) || req.includes(tType);
  });
};

// Normaliza o setor/macro-área do colaborador
const normalizeMacro = (raw?: string): string => {
  const u = (raw || '').toUpperCase().trim();
  if (u.includes('RECEBIMENTO')) return 'RECEBIMENTO';
  if (u.includes('PROCESSAMENTO')) return 'PROCESSAMENTO';
  if (u.includes('EXPEDIÇ') || u.includes('EXPEDIC')) return 'EXPEDIÇÃO';
  return u;
};

// ── Verifica se colaborador tem qualquer treinamento core (para ranking) ──
const hasAnyCore = (collabId: string, trainingsMap: Map<string, string[]>): boolean => {
  const types = trainingsMap.get(collabId) || [];
  return types.some(t => t.includes('ONBOARDING') || CORE_TYPES.some(c => t.includes(c)));
};

// ── Pódio ─────────────────────────────────────────────────────
const PODIUM_CONFIG = [
  { rank: 2, label: '2° Lugar', height: 'h-20', Icon: Medal,  iconColor: 'text-slate-400', cardBorder: 'border-slate-200', rankBg: 'bg-slate-300 text-slate-700', top: 'mt-10' },
  { rank: 1, label: '1° Lugar', height: 'h-28', Icon: Trophy, iconColor: 'text-amber-400', cardBorder: 'border-amber-200', rankBg: 'bg-amber-400 text-white',      top: 'mt-0'  },
  { rank: 3, label: '3° Lugar', height: 'h-14', Icon: Award,  iconColor: 'text-amber-700', cardBorder: 'border-amber-300', rankBg: 'bg-amber-700 text-white',      top: 'mt-16' },
];

export default function DashboardPage() {
  const { profile, isLider } = useAuth();
  const navigate = useNavigate();

  const [stats,      setStats]      = useState({ collaborators: 0, materials: 0, trainings: 0, trainedPct: 0, trainedCount: 0 });
  const [health,     setHealth]     = useState<HealthState>({ pct: 0, completed: 0, total: 0 });
  const [sectorStats,setSectorStats]= useState<SectorStat[]>([]);
  const [socRanking, setSocRanking] = useState<SocRank[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      // ── 1. Colaboradores ────────────────────────────────────
      let allCollabs: { id: string; sector: string; leader: string; soc: string; role: string }[] = [];
      let page = 0; const limit = 1000; let hasMore = true;
      while (hasMore) {
        const { data } = await supabase.from('collaborators').select('id, sector, leader, role, soc').range(page * limit, (page + 1) * limit - 1);
        if (data && data.length > 0) { allCollabs = [...allCollabs, ...data]; if (data.length < limit) hasMore = false; else page++; }
        else hasMore = false;
      }

      // ── 2. Contagens rápidas ────────────────────────────────
      const [mCount, tCount] = await Promise.all([
        supabase.from('materials').select('id', { count: 'exact', head: true }),
        supabase.from('trainings_completed').select('id', { count: 'exact', head: true }),
      ]);

      // ── 3. Treinamentos concluídos ──────────────────────────
      let allTrainings: any[] = [];
      let tPage = 0; let tHasMore = true;
      while (tHasMore) {
        const { data, error } = await supabase.from('trainings_completed').select('collaborator_id, training_type').range(tPage * limit, (tPage + 1) * limit - 1);
        if (error) break;
        if (data) { allTrainings = [...allTrainings, ...data]; if (data.length < limit) tHasMore = false; else tPage++; }
        else tHasMore = false;
      }

      // ── 4. Micro-treinamentos das 3 áreas core (Recebimento, Processamento, Expedição) ──
      const userSoc = profile?.soc || '';
      const { data: microData } = userSoc
        ? await supabase.from('soc_micro_trainings').select('macro_area, name').eq('soc_name', userSoc)
        : { data: [] };

      // Fallback padrão para as 3 áreas específicas
      const defaultMicro: Record<string, string[]> = {
        'RECEBIMENTO':   ['Recebimento FM', 'Recebimento LH', 'Sacas Laranjas', 'Transbordo', 'Fullfilment', 'Staged IN', 'Rompimento Lacre', 'YMS'],
        'PROCESSAMENTO': ['Esteira automática', 'Esteira Java', 'Esteira Termoplástica', 'Puxada IN', 'Tetris', 'Goleiro', 'Setup'],
        'EXPEDIÇÃO':     ['Carregamento LH', 'Carrregamento 3PL', 'Puxada OUT', 'Montagem Carga'],
      };

      const microByMacro = new Map<string, string[]>();
      if (microData && microData.length > 0) {
        microData.forEach((m: any) => {
          const normKey = normalizeMacro(m.macro_area);
          if (['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO'].includes(normKey)) {
            const arr = microByMacro.get(normKey) || [];
            arr.push(m.name);
            microByMacro.set(normKey, arr);
          }
        });
      }
      ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO'].forEach(coreArea => {
        if (!microByMacro.has(coreArea) || microByMacro.get(coreArea)!.length === 0) {
          microByMacro.set(coreArea, defaultMicro[coreArea]);
        }
      });

      // Lista consolidada de TODOS os treinamentos específicos das 3 áreas core (Recebimento + Processamento + Expedição)
      const allCoreMicroTrainings: { name: string; macro: string }[] = [];
      ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO'].forEach(macroKey => {
        const items = microByMacro.get(macroKey) || [];
        items.forEach(tName => {
          allCoreMicroTrainings.push({ name: tName, macro: macroKey });
        });
      });
      const totalCoreTrainingsCount = allCoreMicroTrainings.length;

      // ── 5. Mapa de treinamentos por colaborador ─────────────
      const trainingsMap = new Map<string, string[]>();
      allTrainings.forEach(t => {
        const arr = trainingsMap.get(t.collaborator_id) || [];
        arr.push((t.training_type || '').toUpperCase());
        trainingsMap.set(t.collaborator_id, arr);
      });

      // ── 6. Filtro de colaboradores do usuário ───────────────
      const matchLeader = (collabLeader: string): boolean => {
        const cL = (collabLeader ?? '').trim().toUpperCase();
        if (!cL) return false;
        if (profile?.leader_key) return cL === profile.leader_key.trim().toUpperCase();
        const pName = (profile?.full_name ?? '').trim().toUpperCase();
        if (cL === pName) return true;
        const nw = pName.split(/\s+/).filter(w => w.length > 2);
        if (nw.length > 0 && nw.every(w => cL.includes(w))) return true;
        const lw = cL.split(/\s+/).filter(w => w.length > 2);
        if (lw.length > 0 && lw.every(w => pName.includes(w))) return true;
        return false;
      };
      const socCollabs = userSoc ? allCollabs.filter(c => c.soc === userSoc) : allCollabs;
      const collabs    = isLider ? socCollabs.filter(c => matchLeader(c.leader)) : socCollabs;
      const totalCollabs = collabs.length;

      // ── 7. Índice de saúde (Média do % de conclusão de cada colaborador sobre o TOTAL das 3 áreas) ──
      // Exemplo do modelo:
      // Total de treinamentos específicos (Recebimento + Processamento + Expedição) = N (ex: 14)
      // Bruno concluiu 7 treinamentos dos 14 = 50%
      // Ygor concluiu 14 treinamentos dos 14 = 100%
      // Saúde do SOC = Média(50%, 100%) = 75%
      let sumCollaboratorPcts = 0;
      let evalCollabCount     = 0;

      if (totalCoreTrainingsCount > 0) {
        collabs.forEach(c => {
          const collabMacro = normalizeMacro(c.sector || c.role);
          if (['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO'].includes(collabMacro)) {
            let completedCount = 0;
            allCoreMicroTrainings.forEach(item => {
              if (checkMicroCompleted(c.id, item.name, item.macro, trainingsMap)) {
                completedCount++;
              }
            });

            const indivPct = (completedCount / totalCoreTrainingsCount) * 100;
            sumCollaboratorPcts += indivPct;
            evalCollabCount++;
          }
        });
      }

      const healthPct = evalCollabCount > 0
        ? Number((sumCollaboratorPcts / evalCollabCount).toFixed(1))
        : 0;

      setHealth({ pct: healthPct, completed: totalCoreTrainingsCount, total: evalCollabCount });

      // ── 8. Stats gerais (cards) ─────────────────────────────
      const trainedCollabIds = new Set(
        allTrainings.filter(t => collabs.some(c => c.id === t.collaborator_id)).map(t => t.collaborator_id)
      );
      const pct = totalCollabs > 0 ? Math.round((trainedCollabIds.size / totalCollabs) * 100) : 0;

      setStats({
        collaborators: totalCollabs,
        materials:     mCount.count ?? 0,
        trainings:     isLider ? trainedCollabIds.size : (tCount.count ?? 0),
        trainedPct:    pct,
        trainedCount:  trainedCollabIds.size,
      });

      // ── 9. Stats por setor ──────────────────────────────────
      const sStats: SectorStat[] = SECTORS.map(sector => {
        const isTransversal = sector === 'HSE' || sector === 'PEOPLE';
        const targetCollabs = isTransversal ? collabs : collabs.filter(c => c.sector?.toUpperCase() === sector);
        const total = targetCollabs.length;
        const trained = targetCollabs.filter(c =>
          allTrainings.some(t => {
            if (t.collaborator_id !== c.id) return false;
            const tType = t.training_type?.toUpperCase() ?? '';
            if (isTransversal) return tType.includes(sector);
            const cRole = c.role?.toUpperCase() ?? '';
            const isCore = ['RECEBIMENTO', 'PROCESSAMENTO', 'EXPEDIÇÃO', 'EXPEDICAO'].includes(sector) || sector.includes('LOGISTICA') || cRole.includes('LOGISTICA');
            if (isCore && tType.includes('ONBOARDING')) return true;
            return tType.includes(sector) || sector.includes(tType) || (cRole && (tType.includes(cRole) || cRole.includes(tType)));
          })
        ).length;
        return { sector, total, trained, pct: total > 0 ? Math.round((trained / total) * 100) : 0 };
      });
      setSectorStats(sStats);

      // ── 10. Ranking de SOCs (% com qualquer training core) ──
      const socGroups = new Map<string, string[]>();
      allCollabs.forEach(c => { if (!c.soc) return; const a = socGroups.get(c.soc) || []; a.push(c.id); socGroups.set(c.soc, a); });
      const ranking: SocRank[] = [];
      socGroups.forEach((ids, soc) => {
        const total   = ids.length;
        const trained = ids.filter(id => hasAnyCore(id, trainingsMap)).length;
        const pct     = total > 0 ? Number(((trained / total) * 100).toFixed(1)) : 0;
        ranking.push({ soc, total, trained, pct });
      });
      ranking.sort((a, b) => b.pct - a.pct);
      setSocRanking(ranking);
    };

    fetchStats();
  }, [isLider, profile?.full_name, profile?.soc]);

  const level = getLevel(health.pct);

  const cards = [
    { label: 'Meu Time',    value: stats.collaborators,    icon: Users,        color: 'text-[#EE4D2D]' },
    { label: '% Treinados', value: `${stats.trainedPct}%`, icon: Percent,      color: 'text-emerald-600' },
    { label: 'Materiais',   value: stats.materials,        icon: BarChart2,    color: 'text-[#EE4D2D]' },
    { label: 'Treinados',   value: stats.trainedCount,     icon: CheckCircle2, color: 'text-amber-500' },
  ];

  const top3 = socRanking.slice(0, 3);
  // Ordem do pódio: 2° | 1° | 3°
  const podiumOrder = [top3[1], top3[0], top3[2]];

  // Régua de marcos
  const RULER = [
    { label: 'Crítico', pct:  0, color: 'text-red-400'    },
    { label: 'Bronze',  pct: 70, color: 'text-amber-600'  },
    { label: 'Prata',   pct: 80, color: 'text-slate-500'  },
    { label: 'Ouro',    pct: 95, color: 'text-yellow-500' },
    { label: 'Modelo',  pct: 98, color: 'text-green-500'  },
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
                {userSocLabel(profile?.soc)} Nível de Saúde
              </p>
              <p className={`text-3xl font-black ${level.titleText}`}>{level.name}</p>
              <p className={`text-[10px] font-medium mt-1 ${level.subText}`}>
                {health.total > 0
                  ? `Média individual sobre os ${health.completed} treinamentos específicos (Recebimento, Processamento e Expedição)`
                  : `${stats.trainedCount} de ${stats.collaborators} colaboradores treinados`}
              </p>
            </div>
          </div>

          {/* Direita: % + barra + régua */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[10px] font-black uppercase tracking-widest ${level.subText}`}>Índice de Saúde</span>
              <span className={`text-2xl font-black ${level.titleText}`}>{health.pct}%</span>
            </div>

            {/* Barra de progresso */}
            <div className={`h-2.5 w-full rounded-full overflow-hidden ${level.barBg}`}>
              <div
                className={`h-full rounded-full ${level.barFg} transition-all duration-1000`}
                style={{ width: `${Math.min(health.pct, 100)}%` }}
              />
            </div>

            {/* Régua de níveis */}
            <div className="relative mt-2 h-6">
              {RULER.map(m => (
                <div
                  key={m.label}
                  className="absolute flex flex-col items-center"
                  style={{ left: `${m.pct}%`, transform: 'translateX(-50%)' }}
                >
                  <div className={`w-px h-2 ${level.barBg}`} />
                  <span className={`text-[8px] font-black ${m.color} leading-none`}>{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Cards de estatísticas ────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2.5 rounded-lg ${color.replace('text-', 'bg-').replace('600', '100').replace('500', '100').replace('[#EE4D2D]', '[#FEF6F5]')}`}>
                <Icon size={20} className={color} />
              </div>
              <span className="text-2xl font-black text-gray-900">{value}</span>
            </div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
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

      {/* ── Pódio dos SOCs ──────────────────────────────────── */}
      {socRanking.length >= 2 && (
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <div className="mb-6">
            <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
              <Trophy size={17} className="text-amber-400" />
              Ranking de Saúde dos SOCs
            </h2>
            <p className="text-[10px] text-gray-400 font-medium mt-0.5">Top 3 unidades com maior índice de colaboradores treinados</p>
          </div>

          {/* Pódio visual */}
          <div className="flex items-end justify-center gap-4 pt-4 pb-2">
            {podiumOrder.map((socData, i) => {
              const pos = PODIUM_CONFIG[i];
              if (!socData) return <div key={i} className="w-36" />;
              const lv = getLevel(socData.pct);
              return (
                <div key={socData.soc} className={`flex flex-col items-center gap-2 ${pos.top}`}>
                  <div className={`w-36 rounded-xl border ${pos.cardBorder} bg-white p-4 text-center shadow-sm`}>
                    <div className="text-2xl mb-1">{lv.emoji}</div>
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{pos.label}</p>
                    <p className="text-base font-black text-gray-900 mt-0.5">{socData.soc}</p>
                    <p className={`text-xl font-black mt-1 ${lv.titleText}`}>{socData.pct}%</p>
                    <span className={`inline-block mt-1 text-[8px] font-black px-2 py-0.5 rounded-full border ${lv.badgeBg}`}>{lv.name}</span>
                    <p className="text-[8px] text-gray-400 font-bold mt-2">{socData.trained}/{socData.total}</p>
                  </div>
                  <div className={`w-36 ${pos.height} ${pos.rankBg} rounded-t-lg flex items-center justify-center font-black text-xl`}>
                    {pos.rank}°
                  </div>
                </div>
              );
            })}
          </div>

          {/* Ranking completo */}
          {socRanking.length > 3 && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Ranking Completo</p>
              <div className="space-y-1.5">
                {socRanking.map((s, idx) => {
                  const lv = getLevel(s.pct);
                  return (
                    <div key={s.soc} className="flex items-center gap-3 py-1.5 px-3 rounded-lg hover:bg-gray-50 transition-colors">
                      <span className="text-[11px] font-black text-gray-400 w-6 text-right">{idx + 1}°</span>
                      <span className="text-sm">{lv.emoji}</span>
                      <span className="text-[12px] font-black text-gray-800 flex-1">{s.soc}</span>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${lv.badgeBg}`}>{lv.name}</span>
                      <div className={`w-24 h-1.5 rounded-full overflow-hidden ${lv.barBg}`}>
                        <div className={`h-full rounded-full ${lv.barFg}`} style={{ width: `${s.pct}%` }} />
                      </div>
                      <span className={`text-[11px] font-black w-10 text-right ${lv.titleText}`}>{s.pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function userSocLabel(soc?: string) {
  return soc ? `SOC ${soc} • ` : '';
}
