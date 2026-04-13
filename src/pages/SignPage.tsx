import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Building2, User, CheckCircle2, Search, PenTool, Loader2, GraduationCap, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface Soc {
  id: string;
  name: string;
}

interface Collaborator {
  id: string;
  name: string;
  sector: string;
  soc: string;
  role: string;
}

interface Instructor {
  id: string;
  name: string;
  soc_name: string;
}

export default function SignPage() {
  const [searchParams] = useSearchParams();
  const trainingName = searchParams.get('training') || '';

  const [step, setStep] = useState(1); // 1=SOC, 2=Nome, 3=Instrutor, 4=Assinatura
  const [socs, setSocs] = useState<Soc[]>([]);
  const [selectedSoc, setSelectedSoc] = useState('');

  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [searchName, setSearchName] = useState('');
  const [selectedCollab, setSelectedCollab] = useState<Collaborator | null>(null);

  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [selectedInstructor, setSelectedInstructor] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  // Load SOCs on mount
  useEffect(() => {
    supabase.from('socs').select('id, name').order('name').then(({ data }) => {
      if (data) setSocs(data);
    });
  }, []);

  // Setup canvas when arriving at step 4
  useEffect(() => {
    if (step === 4 && canvasRef.current) {
      const canvas = canvasRef.current;
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
      setHasDrawn(false);
    }
  }, [step]);

  const loadCollaborators = async (socName: string) => {
    const { data } = await supabase
      .from('collaborators')
      .select('id, name, sector, soc, role')
      .eq('soc', socName)
      .order('name');
    setCollaborators(data ?? []);
    setSelectedSoc(socName);
    setStep(2);
  };

  const selectCollab = async (c: Collaborator) => {
    setSelectedCollab(c);
    // Load instructors for this SOC
    const { data } = await supabase
      .from('instructors')
      .select('*')
      .eq('soc_name', c.soc)
      .order('name');
    setInstructors(data ?? []);
    setStep(3);
  };

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const { x, y } = getCoords(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) { ctx.beginPath(); ctx.moveTo(x, y); }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const { x, y } = getCoords(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) { ctx.lineTo(x, y); ctx.stroke(); setHasDrawn(true); }
  };

  const stopDrawing = () => setIsDrawing(false);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      setHasDrawn(false);
    }
  };

  const submitSignature = async () => {
    if (!selectedCollab || !trainingName) return;
    if (!hasDrawn) { toast.error('Por favor, assine no quadro abaixo antes de confirmar.'); return; }
    if (!selectedInstructor) { toast.error('Selecione o instrutor do treinamento.'); return; }

    setIsSubmitting(true);
    try {
      const canvas = canvasRef.current!;
      // Save signature as base64 directly — no storage upload needed for anonymous users
      const signatureData = canvas.toDataURL('image/png');

      const { error: insertError } = await supabase.from('trainings_completed').insert({
        collaborator_id: selectedCollab.id,
        training_type: trainingName,
        signature_pdf_url: signatureData,
        instructor_name: selectedInstructor,
      });

      if (insertError) throw insertError;

      setSuccess(true);
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + (err?.message || JSON.stringify(err)));
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCollabs = collaborators.filter(c =>
    c.name.toLowerCase().includes(searchName.toLowerCase())
  );

  // ── Tela de sucesso ──────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="animate-in zoom-in duration-500 space-y-6 max-w-sm w-full">
          <div className="w-28 h-28 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto border-4 border-emerald-500/30">
            <CheckCircle2 size={56} className="text-emerald-500" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Assinatura Registrada!</h1>
            <p className="text-muted-foreground mt-2">Seu treinamento foi registrado com sucesso no sistema.</p>
          </div>

          <div className="glass-card p-4 text-left space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Colaborador</span>
              <span className="font-semibold text-foreground">{selectedCollab?.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Função</span>
              <span className="font-semibold text-foreground">{selectedCollab?.role}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Treinamento</span>
              <span className="font-semibold text-primary">{trainingName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Instrutor</span>
              <span className="font-semibold text-foreground">{selectedInstructor}</span>
            </div>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors"
          >
            Registrar próximo colaborador
          </button>
        </div>
      </div>
    );
  }

  if (!trainingName) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-2xl font-bold text-destructive mb-2">QR Code inválido</h1>
        <p className="text-muted-foreground">Este QR Code não contém um treinamento identificado.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-4 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-md space-y-5 pb-20">

        {/* Header */}
        <div className="text-center space-y-2 pt-6 pb-2">
          <div className="inline-block px-3 py-1 rounded-full bg-primary/20 text-primary text-xs font-bold uppercase tracking-wider">
            Registro de Presença
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground leading-tight">
            {trainingName}
          </h1>
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`flex items-center gap-2`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
                ${step > s ? 'bg-emerald-500 text-white' : step === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                {step > s ? '✓' : s}
              </div>
              {s < 4 && <div className={`w-6 h-0.5 ${step > s ? 'bg-emerald-500' : 'bg-secondary'}`} />}
            </div>
          ))}
        </div>

        {/* ── Passo 1: Escolher SOC ── */}
        {step === 1 && (
          <div className="glass-card p-6 space-y-4 animate-in slide-in-from-bottom-4">
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <Building2 size={20} className="text-primary" />
              <h2 className="text-lg font-semibold text-foreground">Qual é sua Unidade?</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              {socs.map(s => (
                <button
                  key={s.id}
                  onClick={() => loadCollaborators(s.name)}
                  className="flex items-center gap-3 p-4 rounded-xl bg-secondary/50 hover:bg-primary/20 hover:text-primary hover:border-primary/30 transition-all text-left border border-transparent"
                >
                  <Building2 size={18} />
                  <span className="font-medium text-sm">{s.name}</span>
                </button>
              ))}
              {socs.length === 0 && (
                <p className="col-span-2 text-center text-muted-foreground text-sm py-4">
                  Carregando unidades...
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Passo 2: Buscar nome ── */}
        {step === 2 && (
          <div className="glass-card p-6 space-y-4 animate-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <User size={20} className="text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Quem é você?</h2>
              </div>
              <button onClick={() => { setStep(1); setSearchName(''); }} className="text-xs text-primary hover:underline">
                ← Voltar
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <input
                type="text"
                placeholder="Busque pelo seu nome..."
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                autoFocus
                className="w-full pl-9 pr-4 py-3 rounded-xl bg-secondary border border-border text-foreground outline-none focus:border-primary text-sm"
              />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2">
              {filteredCollabs.map(c => (
                <button
                  key={c.id}
                  onClick={() => selectCollab(c)}
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary transition-colors text-left group"
                >
                  <div>
                    <p className="font-medium text-foreground text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.role} • {c.sector}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                </button>
              ))}
              {filteredCollabs.length === 0 && searchName.length > 0 && (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  Nenhum colaborador encontrado para "{searchName}"
                </p>
              )}
              {collaborators.length === 0 && (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  Nenhum colaborador cadastrado para esta unidade.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Passo 3: Selecionar Instrutor ── */}
        {step === 3 && selectedCollab && (
          <div className="glass-card p-6 space-y-4 animate-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <GraduationCap size={20} className="text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Quem ministrou?</h2>
              </div>
              <button onClick={() => setStep(2)} className="text-xs text-primary hover:underline">
                ← Voltar
              </button>
            </div>

            {/* Ficha do colaborador */}
            <div className="bg-primary/10 p-4 rounded-xl border border-primary/20">
              <p className="text-xs text-muted-foreground mb-1">Colaborador Selecionado</p>
              <p className="font-bold text-primary">{selectedCollab.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{selectedCollab.role} • {selectedCollab.soc} • {selectedCollab.sector}</p>
            </div>

            <div className="space-y-2 pt-1">
              <p className="text-sm text-muted-foreground font-medium">Selecione o instrutor:</p>
              {instructors.map(inst => (
                <button
                  key={inst.id}
                  onClick={() => { setSelectedInstructor(inst.name); setStep(4); }}
                  className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left
                    ${selectedInstructor === inst.name
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-secondary/30 hover:bg-secondary'}`}
                >
                  <div className="flex items-center gap-3">
                    <GraduationCap size={18} />
                    <span className="font-medium text-sm">{inst.name}</span>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </button>
              ))}
              {instructors.length === 0 && (
                <div className="text-center py-6 space-y-2">
                  <p className="text-muted-foreground text-sm">Nenhum instrutor cadastrado para a unidade <strong>{selectedCollab.soc}</strong>.</p>
                  <p className="text-xs text-muted-foreground">Peça ao administrador para cadastrar os instrutores nas Configurações.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Passo 4: Assinatura ── */}
        {step === 4 && selectedCollab && (
          <div className="glass-card p-6 space-y-4 animate-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <PenTool size={20} className="text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Assine aqui</h2>
              </div>
              <button onClick={() => setStep(3)} className="text-xs text-primary hover:underline">
                ← Voltar
              </button>
            </div>

            {/* Ficha completa */}
            <div className="bg-secondary/50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Colaborador</span>
                <span className="font-semibold text-foreground">{selectedCollab.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Função</span>
                <span className="font-semibold text-foreground">{selectedCollab.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Setor</span>
                <span className="font-semibold text-foreground">{selectedCollab.sector}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unidade</span>
                <span className="font-semibold text-foreground">{selectedCollab.soc}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Instrutor</span>
                <span className="font-semibold text-foreground">{selectedInstructor}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Treinamento</span>
                <span className="font-semibold text-primary">{trainingName}</span>
              </div>
            </div>

            {/* Canvas de assinatura */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">Desenhe sua assinatura abaixo:</label>
                <button onClick={clearCanvas} className="text-xs text-destructive hover:underline">Limpar</button>
              </div>
              <div className="bg-white rounded-xl border-2 border-border focus-within:border-primary overflow-hidden touch-none h-[200px] w-full shadow-inner">
                <canvas
                  ref={canvasRef}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  className="w-full h-full cursor-crosshair"
                />
              </div>
              {!hasDrawn && (
                <p className="text-xs text-center text-muted-foreground">Use o dedo para assinar acima</p>
              )}
            </div>

            <button
              disabled={isSubmitting || !hasDrawn}
              onClick={submitSignature}
              className="w-full py-4 mt-2 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center shadow-glow"
            >
              {isSubmitting
                ? <><Loader2 size={22} className="animate-spin mr-2" /> Confirmando...</>
                : 'Confirmar Presença'
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
