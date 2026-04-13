import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Building2, User, CheckCircle2, Search, PenTool, Loader2 } from 'lucide-react';
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
}

export default function SignPage() {
  const [searchParams] = useSearchParams();
  const trainingName = searchParams.get('training');

  const [step, setStep] = useState(1);
  const [socs, setSocs] = useState<Soc[]>([]);
  const [selectedSoc, setSelectedSoc] = useState('');
  
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [searchName, setSearchName] = useState('');
  const [selectedCollab, setSelectedCollab] = useState<Collaborator | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Load SOCs on mount
  useEffect(() => {
    async function loadSocs() {
      const { data } = await supabase.from('socs').select('id, name').order('name');
      if (data) setSocs(data);
    }
    loadSocs();
  }, []);

  // Set up canvas when visiting step 3
  useEffect(() => {
    if (step === 3 && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Handle high DPI displays for crisp drawing
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
        ctx.strokeStyle = '#000000';
      }
    }
  }, [step]);

  const loadCollaborators = async (socName: string) => {
    const { data } = await supabase.from('collaborators').select('id, name, sector, soc').eq('soc', socName).order('name');
    if (data) setCollaborators(data);
    setSelectedSoc(socName);
    setStep(2);
  };

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    return {
      x: (e as React.MouseEvent).clientX - rect.left,
      y: (e as React.MouseEvent).clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      // Clear but respect DPR scaling
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    }
  };

  const submitSignature = async () => {
    if (!selectedCollab || !trainingName || !canvasRef.current) return;
    
    // Check if canvas is actually drawn
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    const hasDrawn = pixelBuffer.some(color => color !== 0);
    
    if (!hasDrawn) {
      toast.error('Por favor, assine no quadro abaixo');
      return;
    }

    setIsSubmitting(true);
    
    try {
      // Get image as base64 and convert to blob
      const dataUrl = canvas.toDataURL('image/png');
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      
      const fileName = `signatures/${Date.now()}_${selectedCollab.id}.png`;
      const { error: uploadError } = await supabase.storage.from('signatures').upload(fileName, blob, { contentType: 'image/png' });
      
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('signatures').getPublicUrl(fileName);

      const { error: insertError } = await supabase.from('trainings_completed').insert({
        collaborator_id: selectedCollab.id,
        training_type: trainingName,
        signature_pdf_url: urlData.publicUrl
      });

      if (insertError) throw insertError;

      setSuccess(true);
    } catch (err: any) {
      toast.error('Erro ao salvar assinatura. Tente novamente.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!trainingName) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6text-center">
        <h1 className="text-2xl font-bold text-destructive mb-2">Treinamento não identificado</h1>
        <p className="text-muted-foreground">O QRCode lido é inválido ou incompleto.</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-500">
        <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6">
          <CheckCircle2 size={48} className="text-emerald-500" />
        </div>
        <h1 className="text-3xl font-display font-bold text-foreground mb-2">Treinamento Concluído!</h1>
        <p className="text-muted-foreground text-lg mb-8">Sua assinatura foi registrada com sucesso.</p>
        <p className="font-medium text-foreground">{selectedCollab?.name}</p>
        <p className="text-sm text-primary">{trainingName}</p>
        
        <button onClick={() => window.location.reload()} className="mt-12 px-6 py-3 rounded-full bg-secondary text-foreground font-medium hover:bg-secondary/80">
          Registrar nova pessoa
        </button>
      </div>
    );
  }

  const filteredCollabs = collaborators.filter(c => c.name.toLowerCase().includes(searchName.toLowerCase()));

  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-4 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-md space-y-6 pb-20">
        
        <div className="text-center space-y-2 mb-8">
          <div className="inline-block px-3 py-1 rounded-full bg-primary/20 text-primary text-xs font-bold uppercase tracking-wider mb-2">
            Registro de Treinamento
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground leading-tight">
            {trainingName}
          </h1>
        </div>

        {/* Passo 1 */}
        {step === 1 && (
          <div className="glass-card p-6 space-y-4 animate-in slide-in-from-bottom-4">
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">1</div>
              <h2 className="text-lg font-semibold text-foreground">Qual sua Unidade?</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {socs.map(s => (
                <button key={s.id} onClick={() => loadCollaborators(s.name)} 
                  className="flex items-center gap-3 p-4 rounded-xl bg-secondary/50 hover:bg-primary/20 hover:text-primary transition-all text-left border border-transparent hover:border-primary/30">
                  <Building2 size={20} />
                  <span className="font-medium">{s.name}</span>
                </button>
              ))}
              {socs.length === 0 && <p className="text-muted-foreground text-sm py-4">Carregando unidades...</p>}
            </div>
          </div>
        )}

        {/* Passo 2 */}
        {step === 2 && (
          <div className="glass-card p-6 space-y-4 animate-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
                <h2 className="text-lg font-semibold text-foreground">Quem é você?</h2>
              </div>
              <button onClick={() => setStep(1)} className="text-sm text-primary hover:underline">Voltar</button>
            </div>
            
            <div className="relative pt-2">
              <Search className="absolute left-3 top-5 text-muted-foreground" size={18} />
              <input 
                type="text" 
                placeholder="Busque pelo seu nome..." 
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-secondary border border-border text-foreground outline-none focus:border-primary"
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {filteredCollabs.map(c => (
                <button key={c.id} onClick={() => { setSelectedCollab(c); setStep(3); }} 
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary transition-colors text-left group">
                  <div className="flex items-center gap-3">
                    <User size={18} className="text-muted-foreground group-hover:text-primary" />
                    <div>
                      <p className="font-medium text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.sector}</p>
                    </div>
                  </div>
                </button>
              ))}
              {filteredCollabs.length === 0 && <p className="text-center text-muted-foreground py-4 text-sm">Nenhum colaborador encontrado</p>}
            </div>
          </div>
        )}

        {/* Passo 3 */}
        {step === 3 && selectedCollab && (
          <div className="glass-card p-6 space-y-4 animate-in slide-in-from-bottom-4">
             <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">3</div>
                <h2 className="text-lg font-semibold text-foreground">Assinatura</h2>
              </div>
              <button onClick={() => setStep(2)} className="text-sm text-primary hover:underline">Voltar</button>
            </div>

            <div className="bg-primary/10 p-4 rounded-xl border border-primary/20">
              <p className="text-sm text-muted-foreground">Colaborador</p>
              <p className="font-bold text-primary">{selectedCollab.name}</p>
              <p className="text-xs text-muted-foreground">{selectedCollab.soc} • {selectedCollab.sector}</p>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <PenTool size={16} /> Desenhe sua assinatura
                </label>
                <button onClick={clearCanvas} className="text-xs font-medium text-destructive hover:underline">Limpar</button>
              </div>
              
              <div className="bg-white rounded-xl overflow-hidden border-2 border-border focus-within:border-primary touch-none relative h-[250px] w-full shadow-inner">
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
            </div>

            <button disabled={isSubmitting} onClick={submitSignature} className="w-full py-4 mt-6 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center shadow-glow">
              {isSubmitting ? <><Loader2 size={24} className="animate-spin mr-2" /> Confirmando...</> : 'Confirmar Presença'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
