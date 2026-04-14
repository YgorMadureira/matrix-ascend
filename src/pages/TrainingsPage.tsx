import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Folder, FolderOpen, Plus, Trash2, ArrowLeft, Edit2, Play, ClipboardList, X } from 'lucide-react';
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
  const initCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    setCanvasRefState(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#1a1a2e';
  };

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
    if (ctx) { ctx.lineTo(x, y); ctx.stroke(); setHasDrawn(true); }
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

      await supabase.from('trainings_completed').insert({
        collaborator_id: user.id,
        training_type: activeTraining.name,
        signature_pdf_url: urlData.publicUrl,
        instructor_name: profile?.full_name || 'Líder',
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
            <button
              onClick={() => { setMustRewatch(false); setExamStep('quiz'); setAnswers({}); }}
              disabled={questions.length === 0}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {questions.length === 0 ? 'Sem questões configuradas' : 'Ir para a Prova'}
            </button>
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

    );
  }

  // ── Normal listing view ──
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Treinamentos</h1>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <button onClick={() => navigateToBreadcrumb(i)} className="hover:text-primary transition-colors">{b.name}</button>
              </span>
            ))}
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowNewTraining(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110 transition-all shadow-glow">
              <Plus size={16} /> Novo Treinamento
            </button>
            <button onClick={() => setShowNewFolder(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-foreground text-sm hover:bg-secondary/80 transition-colors">
              <Plus size={16} /> Pasta
            </button>
          </div>
        )}
      </div>

      {/* New folder */}
      {showNewFolder && isAdmin && (
        <div className="glass-card p-4 flex gap-3">
          <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Nome da pasta"
            className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
            onKeyDown={e => e.key === 'Enter' && createFolder()} />
          <button onClick={createFolder} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Criar</button>
          <button onClick={() => setShowNewFolder(false)} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm">Cancelar</button>
        </div>
      )}

      {/* New training modal */}
      {showNewTraining && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border border-border/40 rounded-xl overflow-hidden p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-display font-semibold text-foreground">Novo Treinamento</h3>
              <button onClick={() => setShowNewTraining(false)} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Nome do Treinamento</label>
                <input value={trainingName} onChange={e => setTrainingName(e.target.value)} placeholder="Ex: NR-12 Líder" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Link do Vídeo (Google Drive)</label>
                <input value={trainingUrl} onChange={e => setTrainingUrl(e.target.value)} placeholder="https://drive.google.com/..." className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
            </div>
            <button onClick={addTraining} className="w-full mt-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:brightness-110 transition-all">
              Adicionar Treinamento
            </button>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {currentFolder && (
          <button onClick={() => navigateToBreadcrumb(breadcrumb.length - 2)} className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center">
            <ArrowLeft size={32} className="text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Voltar</span>
          </button>
        )}
        {folders.map(folder => (
          <div key={folder.id} className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center relative group cursor-pointer" onClick={() => navigateToFolder(folder)}>
            <Folder size={40} className="text-primary" />
            <span className="text-sm font-medium text-foreground">{folder.name}</span>
            {isAdmin && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => { e.stopPropagation(); deleteFolder(folder.id); }} className="p-1.5 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ))}

        {trainings.map(t => (
          <div key={t.id} className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center relative group cursor-pointer" onClick={() => (isLider || isAdmin) ? openTraining(t) : undefined}>
            <div className="p-3 bg-emerald-500/10 rounded-xl">
              <Play size={32} className="text-emerald-500" />
            </div>
            <span className="text-sm font-medium text-foreground">{t.name}</span>
            {isAdmin && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => { e.stopPropagation(); deleteTraining(t.id); }} className="p-1.5 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {folders.length === 0 && trainings.length === 0 && !currentFolder && (
        <div className="glass-card p-12 text-center">
          <FolderOpen size={48} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Nenhum treinamento ainda. {isAdmin ? 'Crie pastas e treinamentos.' : 'Aguarde o administrador adicionar conteúdo.'}</p>
        </div>
      )}
    </div>
  );
}
