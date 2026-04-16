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
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col items-center justify-center p-6 text-center">
        <div className="animate-in zoom-in duration-500 space-y-8 max-w-sm w-full bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
          <div className="w-24 h-24 bg-[#E8F5E9] rounded-full flex items-center justify-center mx-auto border-4 border-white shadow-sm">
            <CheckCircle2 size={48} className="text-[#2E7D32]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Assinatura Coletada!</h1>
            <p className="text-gray-500 mt-2 text-sm leading-relaxed">Sua participação no treinamento foi registrada com sucesso.</p>
          </div>

          <div className="bg-[#FAFAFA] rounded-xl p-5 text-left space-y-4 border border-gray-100">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Colaborador</span>
              <span className="font-semibold text-gray-800 text-sm">{selectedCollab?.name}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Treinamento</span>
              <span className="font-bold text-[#EE4D2D] text-sm">{trainingName}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Instrutor</span>
              <span className="font-semibold text-gray-800 text-sm">{selectedInstructor}</span>
            </div>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="w-full py-4 rounded-xl bg-[#EE4D2D] text-white font-bold hover:brightness-110 active:scale-[0.98] transition-all shadow-md"
          >
            Registrar Próximo
          </button>
        </div>
        <p className="mt-8 text-gray-400 text-[10px] uppercase font-bold tracking-widest">© 2026 Shopee Logistics • Matrix Ascend</p>
      </div>
    );
  }

  if (!trainingName) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-8 rounded-2xl shadow-lg border border-red-50 max-w-sm">
          <X className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">QR Code Inválido</h1>
          <p className="text-gray-500 text-sm">Este código não contém as informações de treinamento necessárias. Por favor, solicite um novo QR Code ao instrutor.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col items-center">
      {/* Top Brand Bar */}
      <div className="w-full h-1 shopee-gradient-bg" />
      
      <div className="w-full max-w-md p-4 sm:p-6 space-y-6 pb-20">

        {/* Header Section */}
        <div className="text-center space-y-3 pt-4">
          <div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-gray-100">
            <img src="/logo_pts.png" alt="Logo" className="h-5" onError={(e) => (e.currentTarget.style.display = 'none')} />
            <span className="text-[10px] font-black text-[#EE4D2D] uppercase tracking-tighter">Matrix Ascend</span>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Registro de Presença</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight">
              {trainingName}
            </h1>
          </div>
        </div>

        {/* Steps Progress */}
        <div className="flex items-center justify-between px-4">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className="flex flex-col items-center gap-2 flex-1 relative">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all z-10
                ${step > s ? 'bg-[#EE4D2D] border-[#EE4D2D] text-white shadow-md' : 
                  step === s ? 'bg-white border-[#EE4D2D] text-[#EE4D2D] shadow-lg scale-110' : 
                  'bg-white border-gray-200 text-gray-300'}`}>
                {step > s ? '✓' : s}
              </div>
              {s < 4 && (
                <div className={`absolute left-1/2 w-full h-[2px] top-5 -z-0
                  ${step > s ? 'bg-[#EE4D2D]' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="animate-fade-in-up">
          {/* Passo 1: Escolher Unidade */}
          {step === 1 && (
            <div className="bg-white rounded-2xl p-6 shadow-xl border border-gray-100 space-y-6">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-gray-900">Sua Unidade</h2>
                <p className="text-xs text-gray-400 font-medium">Selecione onde você trabalha atualmente</p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {socs.map(s => (
                  <button
                    key={s.id}
                    onClick={() => loadCollaborators(s.name)}
                    className="flex items-center justify-between p-5 rounded-xl border-2 border-transparent bg-gray-50 hover:bg-[#FEF6F5] hover:border-[#EE4D2D]/20 transition-all text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-2 bg-white rounded-lg shadow-sm">
                        <Building2 size={24} className="text-[#EE4D2D]" />
                      </div>
                      <span className="font-bold text-gray-800 text-lg">{s.name}</span>
                    </div>
                    <ChevronRight size={20} className="text-gray-300" />
                  </button>
                ))}
                {socs.length === 0 && (
                  <div className="py-12 flex flex-col items-center gap-3">
                    <Loader2 className="animate-spin text-[#EE4D2D]" />
                    <p className="text-sm text-gray-400 font-medium tracking-wide">Buscando unidades...</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Passo 2: Buscar Nome */}
          {step === 2 && (
            <div className="bg-white rounded-2xl p-6 shadow-xl border border-gray-100 space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-gray-900">Quem é você?</h2>
                  <p className="text-xs text-gray-400 font-medium">Filtre pelo seu nome abaixo</p>
                </div>
                <button onClick={() => setStep(1)} className="text-[10px] font-black uppercase text-[#EE4D2D] tracking-widest bg-[#FEF6F5] px-3 py-1.5 rounded-full">Trocar Unidade</button>
              </div>

              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="Seu nome completo..."
                  value={searchName}
                  onChange={e => setSearchName(e.target.value)}
                  autoFocus
                  className="w-full pl-12 pr-4 py-4 rounded-xl bg-gray-50 border border-transparent focus:bg-white focus:border-[#EE4D2D] text-gray-800 font-medium outline-none transition-all shadow-inner"
                />
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {filteredCollabs.map(c => (
                  <button
                    key={c.id}
                    onClick={() => selectCollab(c)}
                    className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-[#FEF6F5] border border-transparent hover:border-[#EE4D2D]/10 transition-all group"
                  >
                    <div className="space-y-0.5">
                      <p className="font-bold text-gray-800 text-base">{c.name}</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{c.role} • {c.sector}</p>
                    </div>
                    <ChevronRight size={18} className="text-gray-300 group-hover:text-[#EE4D2D] transition-colors" />
                  </button>
                ))}
                {filteredCollabs.length === 0 && searchName.length > 0 && (
                  <div className="py-8 text-center text-gray-400 text-sm">Nenhum resultado para este critério</div>
                )}
              </div>
            </div>
          )}

          {/* Passo 3: Escolher Instrutor */}
          {step === 3 && selectedCollab && (
            <div className="bg-white rounded-2xl p-6 shadow-xl border border-gray-100 space-y-6">
               <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-gray-900">Ministrante</h2>
                  <p className="text-xs text-gray-400 font-medium">Quem aplicou o treinamento?</p>
                </div>
                <button onClick={() => setStep(2)} className="text-[10px] font-black uppercase text-[#EE4D2D] tracking-widest bg-[#FEF6F5] px-3 py-1.5 rounded-full">Voltar</button>
              </div>

              <div className="bg-[#FAFAFA] border border-gray-100 p-4 rounded-xl">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1">Colaborador</p>
                <p className="font-bold text-gray-800">{selectedCollab.name}</p>
              </div>

              <div className="space-y-2">
                {instructors.map(inst => (
                  <button
                    key={inst.id}
                    onClick={() => { setSelectedInstructor(inst.name); setStep(4); }}
                    className={`w-full flex items-center justify-between p-5 rounded-xl border-2 transition-all
                      ${selectedInstructor === inst.name
                        ? 'border-[#EE4D2D] bg-[#FEF6F5] text-[#EE4D2D]'
                        : 'border-transparent bg-gray-50 hover:bg-gray-100'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-1.5 rounded-md ${selectedInstructor === inst.name ? 'bg-[#EE4D2D] text-white' : 'bg-white text-gray-400 shadow-sm'}`}>
                        <GraduationCap size={18} />
                      </div>
                      <span className="font-bold">{inst.name}</span>
                    </div>
                  </button>
                ))}
                {instructors.length === 0 && (
                  <div className="bg-yellow-50 p-4 rounded-xl text-yellow-700 text-xs text-center border border-yellow-100">
                    Sua unidade ainda não possui instrutores vinculados. Avise seu líder.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Passo 4: Assinatura */}
          {step === 4 && selectedCollab && (
            <div className="bg-white rounded-2xl p-6 shadow-xl border border-gray-100 space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-gray-900">Assinatura Digital</h2>
                  <p className="text-xs text-gray-400 font-medium">Confirme seus dados e assine</p>
                </div>
                <button onClick={() => setStep(3)} className="text-[10px] font-black uppercase text-[#EE4D2D] tracking-widest bg-[#FEF6F5] px-3 py-1.5 rounded-full">Alterar Instrutor</button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px]">
                 <div className="bg-gray-50 p-2 rounded-lg border border-gray-100">
                    <p className="font-bold text-gray-400 uppercase tracking-widest mb-0.5">Colaborador</p>
                    <p className="font-bold text-gray-800 line-clamp-1">{selectedCollab.name}</p>
                 </div>
                 <div className="bg-gray-50 p-2 rounded-lg border border-gray-100">
                    <p className="font-bold text-gray-400 uppercase tracking-widest mb-0.5">Instrutor</p>
                    <p className="font-bold text-gray-800 line-clamp-1">{selectedInstructor}</p>
                 </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Assine Manualmente:</label>
                  <button onClick={clearCanvas} className="text-[10px] font-bold text-red-500 bg-red-50 px-3 py-1 rounded-full uppercase">Limpar Quadro</button>
                </div>
                <div className="bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 overflow-hidden touch-none h-48 w-full relative group">
                  <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full h-full cursor-crosshair relative z-10"
                  />
                  {!hasDrawn && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300 select-none">
                      <PenTool size={32} strokeWidth={1} />
                      <p className="text-[10px] mt-2 font-black uppercase tracking-widest">Toque e deslize para assinar</p>
                    </div>
                  )}
                </div>
              </div>

              <button
                disabled={isSubmitting || !hasDrawn}
                onClick={submitSignature}
                className="w-full py-5 rounded-xl shopee-gradient-bg text-white font-black text-base uppercase tracking-widest shadow-xl hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-30 disabled:grayscale"
              >
                {isSubmitting
                  ? <div className="flex items-center justify-center gap-3"><Loader2 className="animate-spin" /> <span>Gravando...</span></div>
                  : 'Registrar Presença'
                }
              </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Visual Footer */}
      <div className="fixed bottom-0 left-0 w-full p-4 bg-[#F5F5F5] border-t border-gray-200 text-center pointer-events-none">
          <p className="text-gray-400 text-[10px] uppercase font-bold tracking-[0.3em] opacity-40 leading-none mb-1">PORTAL MATRIX ASCEND • SPX BR</p>
          <div className="flex justify-center gap-1">
             {[1,2,3,4,5].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-300" />)}
          </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 10px; }
      `}</style>
    </div>
  );

}
