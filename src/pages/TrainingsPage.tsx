import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Folder, FolderOpen, Plus, Trash2, ArrowLeft, Edit2, Play, ClipboardList, X, CheckCircle2, Clock, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface FolderItem { id: string; name: string; parent_id: string | null; }
interface TrainingItem { id: string; name: string; video_url: string | null; folder_id: string | null; }

export default function TrainingsPage() {
  const { isAdmin, isLider, user, profile } = useAuth();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [trainings, setTrainings] = useState<TrainingItem[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'Raiz' }]);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewTraining, setShowNewTraining] = useState(false);
  const [trainingName, setTrainingName] = useState('');
  const [trainingUrl, setTrainingUrl] = useState('');

  // Exam states
  const [activeTraining, setActiveTraining] = useState<TrainingItem | null>(null);
  const [examStep, setExamStep] = useState<'video' | 'quiz' | 'sign' | 'done'>('video');
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState(0);
  const [mustRewatch, setMustRewatch] = useState(false);
  const [quizScore, setQuizScore] = useState(0);

  // Video completion validation
  const [hasWatchedVideo, setHasWatchedVideo] = useState(false);
  const [watchTimer, setWatchTimer] = useState(0);
  const REQUIRED_WATCH_TIME = 60; // seconds

  // Signature
  const [canvasRef, setCanvasRefState] = useState<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentFolder = breadcrumb[breadcrumb.length - 1].id;

  const fetchData = async (folderId: string | null) => {
    const [{ data: f }, { data: t }] = await Promise.all([
      supabase.from('training_folders').select('*').eq('parent_id', folderId ?? '').order('name'),
      supabase.from('trainings').select('*').eq('folder_id', folderId ?? '').order('name'),
    ]);
    // Fix: if parent_id is null, use is filter
    if (folderId === null) {
      const [{ data: f2 }, { data: t2 }] = await Promise.all([
        supabase.from('training_folders').select('*').is('parent_id', null).order('name'),
        supabase.from('trainings').select('*').is('folder_id', null).order('name'),
      ]);
      setFolders(f2 ?? []);
      setTrainings(t2 ?? []);
    } else {
      setFolders(f ?? []);
      setTrainings(t ?? []);
    }
  };

  useEffect(() => { fetchData(currentFolder); }, [currentFolder]);

  // Timer: counts seconds while video is being watched
  useEffect(() => {
    if (!activeTraining || examStep !== 'video' || hasWatchedVideo) return;
    const interval = setInterval(() => {
      setWatchTimer(prev => {
        const next = prev + 1;
        if (next >= REQUIRED_WATCH_TIME) {
          setHasWatchedVideo(true);
          clearInterval(interval);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTraining, examStep, hasWatchedVideo]);

  const navigateToFolder = (folder: FolderItem) => {
    setBreadcrumb(prev => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateToBreadcrumb = (index: number) => {
    setBreadcrumb(prev => prev.slice(0, index + 1));
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    await supabase.from('training_folders').insert({ name: newFolderName.trim(), parent_id: currentFolder });
    setNewFolderName('');
    setShowNewFolder(false);
    fetchData(currentFolder);
    toast.success('Pasta criada');
  };

  const deleteFolder = async (id: string) => {
    if (!confirm('Excluir esta pasta?')) return;
    await supabase.from('training_folders').delete().eq('id', id);
    fetchData(currentFolder);
    toast.success('Pasta removida');
  };

  const addTraining = async () => {
    if (!trainingName.trim() || !trainingUrl.trim()) { toast.error('Preencha nome e link'); return; }
    let url = trainingUrl.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    await supabase.from('trainings').insert({ name: trainingName.trim(), video_url: url, folder_id: currentFolder });
    setTrainingName('');
    setTrainingUrl('');
    setShowNewTraining(false);
    fetchData(currentFolder);
    toast.success('Treinamento adicionado');
  };

  const deleteTraining = async (id: string) => {
    if (!confirm('Excluir este treinamento?')) return;
    await supabase.from('trainings').delete().eq('id', id);
    fetchData(currentFolder);
    toast.success('Treinamento removido');
  };

  // ── Leader flow: open training ──
  const openTraining = async (t: TrainingItem) => {
    setActiveTraining(t);
    setExamStep('video');
    setAnswers({});
    setQuizScore(0);
    setHasDrawn(false);
    setHasWatchedVideo(false);
    setWatchTimer(0);

    // Check attempts
    if (user) {
      const { data: att } = await supabase.from('quiz_attempts')
        .select('*')
        .eq('training_id', t.id)
        .eq('user_id', user.id)
        .eq('passed', false)
        .order('taken_at', { ascending: false });
      
      const failedCount = att?.length ?? 0;
      setAttempts(failedCount);

      if (failedCount >= 5) {
        setMustRewatch(true);
      } else {
        setMustRewatch(false);
      }

      // Check if already passed
      const { data: passed } = await supabase.from('quiz_attempts')
        .select('*')
        .eq('training_id', t.id)
        .eq('user_id', user.id)
        .eq('passed', true)
        .limit(1);
      
      if (passed && passed.length > 0) {
        toast.info('Você já concluiu este treinamento!');
      }
    }

    // Load questions
    const { data: q } = await supabase.from('quiz_questions')
      .select('*')
      .eq('training_id', t.id)
      .order('order_num');
    setQuestions(q ?? []);
  };

  const getGDriveEmbedUrl = (url: string) => {
    // Convert Google Drive share link to embed
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return `https://drive.google.com/file/d/${match[1]}/preview`;
    return url;
  };

  const submitQuiz = async () => {
    if (!activeTraining || !user) return;
    const total = questions.length;
    if (total === 0) { toast.error('Nenhuma questão configurada para este treinamento.'); return; }

    let correct = 0;
    questions.forEach(q => {
      if (answers[q.id] === q.correct_option) correct++;
    });

    const score = Math.round((correct / total) * 100);
    const passed = score >= 90;
    setQuizScore(score);

    await supabase.from('quiz_attempts').insert({
      training_id: activeTraining.id,
      user_id: user.id,
      score,
      passed,
      attempt_number: attempts + 1,
    });

    if (passed) {
      setExamStep('sign');
      toast.success(`Aprovado! ${correct}/${total} acertos (${score}%)`);
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= 5) {
        setMustRewatch(true);
        toast.error(`Reprovado (${score}%). Você atingiu 5 tentativas. Assista o vídeo novamente.`);
        // Reset attempts for next cycle
        await supabase.from('quiz_attempts')
          .delete()
          .eq('training_id', activeTraining.id)
          .eq('user_id', user.id)
          .eq('passed', false);
        setAttempts(0);
        setExamStep('video');
      } else {
        toast.error(`Reprovado (${score}%). Tentativa ${newAttempts}/5. Tente novamente.`);
        setAnswers({});
      }
    }
  };

  // Canvas signature helpers
  const initCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    setCanvasRefState(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== Math.floor(rect.width * dpr)) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#1a1a2e';
    }
  }, []);

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef) return { x: 0, y: 0 };
    const rect = canvasRef.getBoundingClientRect();
    if ('touches' in e) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); setIsDrawing(true);
    const { x, y } = getCoords(e);
    const ctx = canvasRef?.getContext('2d');
    if (ctx) { ctx.beginPath(); ctx.moveTo(x, y); }
  };
  const drawMove = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); if (!isDrawing) return;
    const { x, y } = getCoords(e);
    const ctx = canvasRef?.getContext('2d');
    if (ctx) { ctx.lineTo(x, y); ctx.stroke(); if (!hasDrawn) setHasDrawn(true); }
  };
  const stopDraw = () => setIsDrawing(false);
  const clearCanvas = () => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    if (ctx) { ctx.clearRect(0, 0, canvasRef.width / dpr, canvasRef.height / dpr); setHasDrawn(false); }
  };

  const submitSignature = async () => {
    if (!activeTraining || !user || !canvasRef || !hasDrawn) {
      toast.error('Assine antes de confirmar.');
      return;
    }
    setIsSubmitting(true);
    try {
      const dataUrl = canvasRef.toDataURL('image/png');
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const fileName = `signatures/${Date.now()}_${user.id}.png`;
      await supabase.storage.from('signatures').upload(fileName, blob, { contentType: 'image/png' });
      const { data: urlData } = supabase.storage.from('signatures').getPublicUrl(fileName);

      // Assegurar que o usuário existe na tabela de colaboradores usando os dados do logado
      if (profile && user) {
        const { data: existCollab } = await supabase.from('collaborators').select('id').eq('id', user.id).maybeSingle();
        if (!existCollab) {
           await supabase.from('collaborators').insert({
             id: user.id,
             name: profile.full_name,
             opsid: profile.opsid || `LIDER-${user.id.substring(0, 4).toUpperCase()}`,
             role: profile.role === 'lider' ? 'Líder' : (profile.role || 'Líder'),
             sector: profile.sector || 'Gestão',
             shift: 'T1',
             leader: 'Gestão SPX',
             soc: profile.soc || 'SP6',
             gender: 'Não Informado'
           });
        }
      }

      await supabase.from('trainings_completed').insert({
        collaborator_id: user.id,
        training_type: activeTraining.name,
        signature_pdf_url: urlData.publicUrl,
        instructor_name: 'PLATAFORMA',
      });

      setExamStep('done');
      toast.success('Treinamento concluído e assinatura registrada!');
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Active training view (leader flow) ──
  if (activeTraining) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <button onClick={() => setActiveTraining(null)} className="text-sm text-primary hover:underline">← Voltar aos Treinamentos</button>
        <h1 className="text-2xl font-display font-bold text-foreground">{activeTraining.name}</h1>

        {examStep === 'video' && (
          <div className="space-y-4">
            <div className="glass-card overflow-hidden rounded-xl">
              {activeTraining.video_url ? (
                <iframe
                  src={getGDriveEmbedUrl(activeTraining.video_url)}
                  className="w-full aspect-video"
                  allow="autoplay; encrypted-media"
                  allowFullScreen
                  title={activeTraining.name}
                />
              ) : (
                <div className="p-12 text-center text-muted-foreground">Nenhum vídeo configurado</div>
              )}
            </div>
            {mustRewatch && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 text-center">
                <p className="text-destructive font-semibold">Você errou 5 vezes. Assista o vídeo completo antes de tentar novamente.</p>
              </div>
            )}
            {!hasWatchedVideo ? (
              <div className="w-full py-3 rounded-xl bg-gray-100 text-gray-400 font-bold text-center flex items-center justify-center gap-2">
                <Lock size={16} /> Assista o conteúdo completo ({Math.max(0, REQUIRED_WATCH_TIME - watchTimer)}s restantes)
              </div>
            ) : (
              <button
                onClick={() => { setMustRewatch(false); setExamStep('quiz'); setAnswers({}); }}
                disabled={questions.length === 0}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:brightness-110 disabled:opacity-50 transition-all animate-in fade-in duration-500"
              >
                {questions.length === 0 ? 'Sem questões configuradas' : 'Ir para a Prova'}
              </button>
            )}
          </div>
        )}

        {examStep === 'quiz' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Prova — {questions.length} questões</h2>
              <span className="text-sm text-muted-foreground">Tentativa {attempts + 1}/5 • Mínimo 90%</span>
            </div>
            {questions.map((q, i) => (
              <div key={q.id} className="glass-card p-5 space-y-3">
                <p className="font-medium text-foreground"><span className="text-primary font-bold">{i + 1}.</span> {q.question}</p>
                {['a', 'b', 'c', 'd'].map(opt => (
                  <label key={opt} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${answers[q.id] === opt ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30 hover:bg-secondary'}`}>
                    <input
                      type="radio"
                      name={`q_${q.id}`}
                      value={opt}
                      checked={answers[q.id] === opt}
                      onChange={() => setAnswers(prev => ({ ...prev, [q.id]: opt }))}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground">
                      <strong className="text-primary mr-1">{opt.toUpperCase()})</strong> {q[`option_${opt}`]}
                    </span>
                  </label>
                ))}
              </div>
            ))}
            <button
              onClick={submitQuiz}
              disabled={Object.keys(answers).length < questions.length}
              className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:brightness-110 disabled:opacity-50 transition-all"
            >
              Finalizar Prova
            </button>
          </div>
        )}

        {examStep === 'sign' && (
          <div className="glass-card p-6 space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
              <p className="text-emerald-500 font-bold text-lg">Aprovado! {quizScore}% de acerto</p>
            </div>
            <p className="text-sm text-muted-foreground text-center">Agora assine para confirmar o treinamento.</p>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-foreground">Assinatura eletrônica:</span>
                <button onClick={clearCanvas} className="text-xs text-destructive hover:underline">Limpar</button>
              </div>
              <div className="bg-white rounded-xl border-2 border-border overflow-hidden touch-none h-[200px] w-full shadow-inner">
                <canvas
                  ref={initCanvas}
                  onMouseDown={startDraw} onMouseMove={drawMove} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={startDraw} onTouchMove={drawMove} onTouchEnd={stopDraw}
                  className="w-full h-full cursor-crosshair"
                />
              </div>
            </div>
            <button
              onClick={submitSignature}
              disabled={isSubmitting || !hasDrawn}
              className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold hover:brightness-110 disabled:opacity-50"
            >
              {isSubmitting ? 'Salvando...' : 'Confirmar Treinamento'}
            </button>
          </div>
        )}

        {examStep === 'done' && (
          <div className="text-center space-y-6 py-12">
            <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto border-4 border-emerald-500/30">
              <ClipboardList size={48} className="text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Treinamento Concluído!</h2>
            <p className="text-muted-foreground">Sua assinatura foi registrada no sistema.</p>
            <button onClick={() => setActiveTraining(null)} className="px-8 py-3 rounded-xl bg-secondary text-foreground hover:bg-secondary/80">
              Voltar
            </button>
          </div>
        )}
      </div>
    );
  }



  // ── Normal listing view ──
  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Capacitação EAD</h1>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
            {breadcrumb.map((b, i) => (
              <div key={i} className="flex items-center gap-2 whitespace-nowrap">
                {i > 0 && <span className="text-gray-300 font-bold">/</span>}
                <button 
                  onClick={() => navigateToBreadcrumb(i)} 
                  className={`text-xs font-black uppercase tracking-widest transition-all
                    ${i === breadcrumb.length - 1 ? 'text-[#EE4D2D]' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {b.name}
                </button>
              </div>
            ))}
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-3 flex-wrap">
             <button 
              onClick={() => setShowNewFolder(true)} 
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gray-50 text-gray-700 text-xs font-black uppercase tracking-wider hover:bg-gray-100 transition-colors border border-gray-200 shadow-sm"
            >
              <Folder size={16} /> Nova Pasta
            </button>
            <button 
              onClick={() => setShowNewTraining(true)} 
              className="flex items-center gap-2 px-6 py-2.5 rounded-full shopee-gradient-bg text-white text-xs font-black uppercase tracking-widest hover:brightness-110 shadow-lg active:scale-95 transition-all"
            >
              <Plus size={18} /> Novo Material
            </button>
          </div>
        )}
      </div>

      {/* New folder inline form */}
      {showNewFolder && isAdmin && (
        <div className="bg-white p-6 rounded-2xl shadow-xl border-2 border-[#EE4D2D]/20 animate-in slide-in-from-top-4 flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-1 w-full space-y-1">
             <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nome da Pasta</label>
             <input 
              value={newFolderName} 
              onChange={e => setNewFolderName(e.target.value)} 
              placeholder="Ex: Treinamentos 2026"
              className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all"
              onKeyDown={e => e.key === 'Enter' && createFolder()} 
            />
          </div>
          <div className="flex gap-2 w-full md:w-auto pt-5">
            <button onClick={createFolder} className="flex-1 md:flex-none px-6 py-3 rounded-xl bg-[#EE4D2D] text-white text-xs font-black uppercase tracking-widest">Confirmar</button>
            <button onClick={() => setShowNewFolder(false)} className="px-6 py-3 rounded-xl bg-gray-100 text-gray-500 text-xs font-black uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* New training modal overlay */}
      {showNewTraining && isAdmin && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-black text-gray-900">Novo Material</h3>
              <button onClick={() => setShowNewTraining(false)} className="p-2 rounded-full hover:bg-gray-100 transition-colors"><X size={20} /></button>
            </div>
            
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Título do Conteúdo</label>
                <input value={trainingName} onChange={e => setTrainingName(e.target.value)} placeholder="Ex: Onboarding SPX" className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Link do Vídeo (Google Drive)</label>
                <input value={trainingUrl} onChange={e => setTrainingUrl(e.target.value)} placeholder="Cole o link de compartilhamento aqui" className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent text-gray-800 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[#EE4D2D]/10 transition-all" />
              </div>
            </div>

            <button onClick={addTraining} className="w-full py-4 rounded-xl shopee-gradient-bg text-white font-black text-xs uppercase tracking-[0.2em] shadow-lg hover:brightness-110 transition-all">
              Salvar Treinamento
            </button>
          </div>
        </div>
      )}

      {/* Folders & Files Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
        {currentFolder && (
          <button 
            onClick={() => navigateToBreadcrumb(breadcrumb.length - 2)} 
            className="flex flex-col items-center justify-center gap-4 p-8 rounded-2xl bg-white border border-dashed border-gray-200 text-gray-300 hover:text-[#EE4D2D] hover:border-[#EE4D2D]/30 transition-all group"
          >
            <ArrowLeft size={32} className="group-hover:-translate-x-1 transition-transform" />
            <span className="text-[10px] font-black uppercase tracking-widest">Voltar</span>
          </button>
        )}

        {folders.map(folder => (
          <div 
            key={folder.id} 
            onClick={() => navigateToFolder(folder)}
            className="group relative flex flex-col items-center gap-4 p-8 rounded-2xl bg-white shadow-sm border border-gray-50 hover:border-[#EE4D2D]/10 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer"
          >
            <div className="relative">
              <Folder size={56} className="text-[#EE4D2D]/80 drop-shadow-sm group-hover:scale-110 transition-transform" fill="currentColor" />
              <div className="absolute inset-0 flex items-center justify-center">
                 <div className="w-4 h-4 bg-white/20 rounded-full blur-sm" />
              </div>
            </div>
            <span className="text-xs font-black text-gray-800 uppercase tracking-tight text-center line-clamp-2">{folder.name}</span>
            
            {isAdmin && (
              <button 
                onClick={e => { e.stopPropagation(); deleteFolder(folder.id); }} 
                className="absolute top-3 right-3 p-2 rounded-lg bg-red-50 text-red-500 opacity-0 group-hover:opacity-100 hover:bg-red-100 transition-all scale-75"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}

        {trainings.map(t => (
          <div 
            key={t.id} 
            onClick={() => (isLider || isAdmin) ? openTraining(t) : undefined}
            className="group relative flex flex-col items-center gap-4 p-8 rounded-2xl bg-white shadow-sm border border-gray-50 hover:border-emerald-200 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer"
          >
            <div className="p-5 bg-emerald-50 rounded-2xl text-emerald-500 group-hover:bg-emerald-500 group-hover:text-white transition-all shadow-inner">
               <Play size={32} fill="currentColor" />
            </div>
            <span className="text-xs font-black text-gray-800 uppercase tracking-tight text-center line-clamp-2">{t.name}</span>
            
            {isAdmin && (
              <button 
                onClick={e => { e.stopPropagation(); deleteTraining(t.id); }} 
                className="absolute top-3 right-3 p-2 rounded-lg bg-red-50 text-red-500 opacity-0 group-hover:opacity-100 hover:bg-red-100 transition-all scale-75"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Empty State */}
      {folders.length === 0 && trainings.length === 0 && (
        <div className="py-24 bg-white rounded-3xl border border-dashed border-gray-200 text-center space-y-4">
          <div className="inline-flex p-6 bg-gray-50 rounded-full text-gray-200">
             <FolderOpen size={48} />
          </div>
          <div className="max-w-xs mx-auto space-y-1">
             <h3 className="text-gray-900 font-black uppercase tracking-widest text-sm">Diretório Vazio</h3>
             <p className="text-xs text-gray-400 font-medium">Não há materiais disponíveis nesta sub-pasta no momento.</p>
          </div>
        </div>
      )}

      {/* Overlay modal para visualização e prova (mantendo lógica anterior com novo estilo) */}
      {activeTraining && (
        <div className="fixed inset-0 z-50 bg-gray-900/60 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto pt-20 pb-20 animate-in fade-in duration-300">
           <div className="w-full max-w-4xl bg-[#F5F5F5] rounded-3xl shadow-2xl overflow-hidden border border-white/20 animate-in slide-in-from-bottom-8 duration-500">
              {/* Header Modal */}
              <div className="bg-white p-6 border-b border-gray-100 flex items-center justify-between">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 text-emerald-500 rounded-xl"><Play size={20} /></div>
                    <div>
                       <h2 className="text-xl font-black text-gray-900">{activeTraining.name}</h2>
                       <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{examStep === 'video' ? 'Fase 1: Aprendizado' : examStep === 'quiz' ? 'Fase 2: Avaliação' : 'Fase 3: Conclusão'}</p>
                    </div>
                 </div>
                 <button onClick={() => setActiveTraining(null)} className="p-3 rounded-xl bg-gray-50 text-gray-500 hover:bg-gray-100 font-black uppercase text-[10px] tracking-widest flex items-center gap-2">
                    <X size={16} /> Fechar
                 </button>
              </div>

              <div className="p-6 lg:p-10">
                {examStep === 'video' && (
                  <div className="space-y-8 max-w-3xl mx-auto">
                    <div className="relative group overflow-hidden rounded-3xl shadow-2xl border-4 border-white bg-black aspect-video">
                      {activeTraining.video_url ? (
                        <iframe
                          src={getGDriveEmbedUrl(activeTraining.video_url)}
                          className="w-full h-full"
                          allow="autoplay; encrypted-media"
                          allowFullScreen
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-500 font-bold uppercase tracking-widest">Nenhum vídeo disponível</div>
                      )}
                    </div>
                    {mustRewatch && (
                      <div className="bg-red-50 border border-red-100 p-5 rounded-2xl flex items-center gap-4 animate-bounce">
                        <div className="w-10 h-10 bg-red-500 text-white rounded-full flex items-center justify-center flex-shrink-0 font-black">!</div>
                        <p className="text-red-700 font-bold text-sm">Você errou 5 vezes. Assista ao conteúdo completo com atenção antes de reiniciar a prova.</p>
                      </div>
                    )}

                    {/* Progress bar + timer */}
                    {!hasWatchedVideo && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs font-bold text-gray-400 uppercase tracking-widest">
                          <span className="flex items-center gap-2"><Clock size={14} /> Assistindo o conteúdo...</span>
                          <span>{Math.min(watchTimer, REQUIRED_WATCH_TIME)}s / {REQUIRED_WATCH_TIME}s</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-[#EE4D2D] to-[#FF6B47] rounded-full transition-all duration-1000" style={{ width: `${Math.min((watchTimer / REQUIRED_WATCH_TIME) * 100, 100)}%` }} />
                        </div>
                      </div>
                    )}

                    {hasWatchedVideo ? (
                      <button
                        onClick={() => { setMustRewatch(false); setExamStep('quiz'); setAnswers({}); }}
                        disabled={questions.length === 0}
                        className="w-full py-5 rounded-2xl shopee-gradient-bg text-white font-black uppercase text-base tracking-[0.3em] shadow-xl hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 animate-in fade-in slide-in-from-bottom-4 duration-500"
                      >
                        {questions.length === 0 ? 'CONTEÚDO SEM AVALIAÇÃO' : 'INICIAR PROVA CERTIFICADORA'}
                      </button>
                    ) : (
                      <div className="w-full py-5 rounded-2xl bg-gray-100 text-gray-400 font-black uppercase text-base tracking-[0.3em] text-center flex items-center justify-center gap-3">
                        <Lock size={18} /> CONCLUA O CONTEÚDO PARA LIBERAR A PROVA
                      </div>
                    )}
                  </div>
                )}

                {examStep === 'quiz' && (
                  <div className="space-y-8 max-w-2xl mx-auto">
                    <div className="flex flex-col md:flex-row items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 gap-4">
                       <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-[#FEF6F5] text-[#EE4D2D] rounded-full flex items-center justify-center font-black">?</div>
                          <span className="text-xs font-black text-gray-400 uppercase tracking-widest">{questions.length} Questões Totais</span>
                       </div>
                       <div className="px-4 py-2 bg-amber-50 text-amber-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-amber-100">
                          Tentativa {attempts + 1} de 5
                       </div>
                    </div>

                    <div className="space-y-8">
                       {questions.map((q, i) => (
                         <div key={q.id} className="space-y-4">
                            <div className="flex items-start gap-4">
                               <span className="text-3xl font-black text-[#EE4D2D] opacity-20">0{i+1}</span>
                               <p className="text-lg font-bold text-gray-800 pt-2 leading-relaxed">{q.question}</p>
                            </div>
                            <div className="grid grid-cols-1 gap-3 ml-0 md:ml-12">
                               {['a', 'b', 'c', 'd'].map(opt => (
                                 <label 
                                  key={opt} 
                                  className={`flex items-center gap-4 p-5 rounded-2xl cursor-pointer transition-all border-2
                                    ${answers[q.id] === opt 
                                      ? 'border-[#EE4D2D] bg-white shadow-md' 
                                      : 'border-transparent bg-white/50 hover:bg-white'}`}
                                 >
                                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-black uppercase text-xs transition-colors
                                      ${answers[q.id] === opt ? 'bg-[#EE4D2D] border-[#EE4D2D] text-white' : 'border-gray-200 text-gray-400'}`}>
                                       {opt}
                                    </div>
                                    <span className="text-sm font-bold text-gray-700 transition-colors uppercase tracking-tight line-clamp-2">{q[`option_${opt}`]}</span>
                                    <input
                                      type="radio"
                                      name={`q_${q.id}`}
                                      value={opt}
                                      checked={answers[q.id] === opt}
                                      onChange={() => setAnswers(prev => ({ ...prev, [q.id]: opt }))}
                                      className="hidden"
                                    />
                                 </label>
                               ))}
                            </div>
                         </div>
                       ))}
                    </div>

                    <button
                      onClick={submitQuiz}
                      disabled={Object.keys(answers).length < questions.length}
                      className="w-full py-6 rounded-2xl shopee-gradient-bg text-white font-black uppercase text-lg tracking-[0.4em] shadow-xl hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-30"
                    >
                      FINALIZAR AVALIAÇÃO
                    </button>
                  </div>
                )}

                {examStep === 'sign' && (
                   <div className="max-w-md mx-auto space-y-8 py-4">
                      <div className="text-center space-y-4">
                         <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm border-4 border-white">
                            <CheckCircle2 size={40} />
                         </div>
                         <div>
                            <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tight">Você foi aprovado!</h3>
                            <p className="text-sm text-gray-500 font-medium">Nota final: <strong>{quizScore}%</strong>. Agora precisamos da sua assinatura oficial.</p>
                         </div>
                      </div>

                      <div className="bg-white p-8 rounded-3xl shadow-xl border border-gray-100 space-y-6">
                         <div className="flex justify-between items-center px-1">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Assine no quadro abaixo:</span>
                            <button onClick={clearCanvas} className="text-[10px] font-black text-red-500 bg-red-50 px-3 py-1 rounded-full uppercase">Limpar</button>
                         </div>
                         <div className="bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 overflow-hidden touch-none h-48 w-full relative group">
                            <canvas
                              ref={initCanvas}
                              onMouseDown={startDraw} onMouseMove={drawMove} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                              onTouchStart={startDraw} onTouchMove={drawMove} onTouchEnd={stopDraw}
                              className="w-full h-full cursor-crosshair relative z-10"
                            />
                            {!hasDrawn && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300 select-none pointer-events-none">
                                <Edit2 size={32} strokeWidth={1} />
                                <p className="text-[8px] mt-2 font-black uppercase tracking-[0.2em]">Deslize aqui para assinar</p>
                              </div>
                            )}
                         </div>
                         <button
                           onClick={submitSignature}
                           disabled={isSubmitting || !hasDrawn}
                           className="w-full py-5 rounded-2xl shopee-gradient-bg text-white font-black uppercase tracking-[0.2em] shadow-lg hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-30"
                         >
                           {isSubmitting ? 'CERTIFICANDO...' : 'CONFIRMAR CERTIFICAÇÃO'}
                         </button>
                      </div>
                   </div>
                )}

                {examStep === 'done' && (
                   <div className="text-center space-y-8 py-12 max-w-sm mx-auto">
                      <div className="relative">
                         <div className="w-32 h-32 bg-[#FEF6F5] rounded-full flex items-center justify-center mx-auto border-8 border-white shadow-xl animate-in zoom-in duration-700">
                             <ClipboardList size={56} className="text-[#EE4D2D]" />
                         </div>
                         <div className="absolute top-0 right-1/4 w-8 h-8 bg-emerald-500 rounded-full border-4 border-white flex items-center justify-center text-white animate-bounce">
                            <CheckCircle2 size={16} />
                         </div>
                      </div>
                      <div className="space-y-2">
                         <h2 className="text-3xl font-black text-gray-900 uppercase tracking-tight">Sucesso Total!</h2>
                         <p className="text-sm border-gray-400 text-gray-500 font-medium leading-relaxed">Parabéns. Sua certificação em <strong>{activeTraining.name}</strong> foi devidamente registrada e já consta nos relatórios oficiais.</p>
                      </div>
                      <button 
                        onClick={() => setActiveTraining(null)} 
                        className="w-full py-4 rounded-2xl bg-gray-900 text-white font-black uppercase tracking-[0.2em] hover:bg-black shadow-lg transition-all"
                      >
                         VOLTAR AO PAINEL
                      </button>
                   </div>
                )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
