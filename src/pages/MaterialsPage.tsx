import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Folder, FileText, Plus, ArrowLeft, Edit2, Trash2, FolderOpen, X, QrCode, ChevronRight, Home } from 'lucide-react';
import { toast } from 'sonner';

interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
}

interface MaterialItem {
  id: string;
  name: string;
  description: string | null;
  file_url: string | null;
  file_type: string | null;
  folder_id: string | null;
}

interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export default function MaterialsPage() {
  const { isAdmin, user, loading: authLoading } = useAuth();

  // Core navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ id: null, name: 'Raiz' }]);

  // Data state
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // UI state
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const [editingFolder, setEditingFolder] = useState<FolderItem | null>(null);
  const [editFolderName, setEditFolderName] = useState('');

  const [showNewMaterial, setShowNewMaterial] = useState(false);
  const [materialName, setMaterialName] = useState('');
  const [materialUrl, setMaterialUrl] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);

  const [showingQrFor, setShowingQrFor] = useState<MaterialItem | null>(null);

  // Helper para evitar requisições presas infinitamente (ex: timeout de conexão)
  const withTimeout = <T,>(promise: Promise<T>, ms: number = 8000): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error('Tempo esgotado. Verifique sua conexão e tente novamente.')), ms)
      )
    ]);
  };

  // ─── Data Loading ───────────────────────────────────────────
  const loadFolder = async (folderId: string | null) => {
    setIsLoading(true);

    try {
      // Clear old data immediately to prevent stale UI
      setFolders([]);
      setMaterials([]);

      let folderQuery;
      let materialQuery;

      if (folderId === null) {
        folderQuery = supabase.from('folders').select('*').is('parent_id', null).order('name');
        materialQuery = supabase.from('materials').select('*').is('folder_id', null).order('name');
      } else {
        folderQuery = supabase.from('folders').select('*').eq('parent_id', folderId).order('name');
        materialQuery = supabase.from('materials').select('*').eq('folder_id', folderId).order('name');
      }

      const [folderResult, materialResult] = await Promise.all([folderQuery, materialQuery]);

      if (folderResult.error) {
        console.error('[Materials] Erro ao buscar pastas:', folderResult.error);
        toast.error('Erro ao carregar pastas: ' + folderResult.error.message);
      }
      if (materialResult.error) {
        console.error('[Materials] Erro ao buscar materiais:', materialResult.error);
      }

      setFolders(folderResult.data ?? []);
      setMaterials(materialResult.data ?? []);
    } catch (err) {
      console.error('[Materials] Erro crítico:', err);
      toast.error('Erro de conexão ao carregar materiais.');
    } finally {
      setIsLoading(false);
    }
  };

  // Load when currentFolderId changes (single source of truth)
  useEffect(() => {
    if (!authLoading) {
      loadFolder(currentFolderId);
    }
  }, [currentFolderId, authLoading]);

  // ─── Navigation ─────────────────────────────────────────────
  const navigateToFolder = (folder: FolderItem) => {
    // Prevent navigating to same folder
    if (currentFolderId === folder.id) return;

    setCurrentFolderId(folder.id);
    setBreadcrumb(prev => {
      // Protection: don't add if already the last item
      if (prev[prev.length - 1].id === folder.id) return prev;
      return [...prev, { id: folder.id, name: folder.name }];
    });
  };

  const navigateToBreadcrumb = (index: number) => {
    const target = breadcrumb[index];
    if (target.id === currentFolderId) return; // already there

    setBreadcrumb(prev => prev.slice(0, index + 1));
    setCurrentFolderId(target.id);
  };

  const goBack = () => {
    if (breadcrumb.length <= 1) return;
    const newBreadcrumb = breadcrumb.slice(0, -1);
    setBreadcrumb(newBreadcrumb);
    setCurrentFolderId(newBreadcrumb[newBreadcrumb.length - 1].id);
  };

  // ─── Folder CRUD ────────────────────────────────────────────
  const createFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error('Digite o nome da pasta');
      return;
    }
    if (isCreatingFolder) return;

    setIsCreatingFolder(true);
    try {
      const parent_val = currentFolderId ? currentFolderId : null;
      
      const response = await withTimeout(
        supabase.from('folders').insert({
          name: newFolderName.trim(),
          parent_id: parent_val,
        }).select().single()
      );

      if (response.error) {
        toast.error('Erro ao criar pasta: ' + response.error.message);
        return;
      }

      toast.success('Pasta criada com sucesso!');
      setNewFolderName('');
      setShowNewFolder(false);
      await loadFolder(currentFolderId);
    } catch (err: any) {
      console.error('[Materials] Erro ao criar pasta:', err);
      toast.error('Erro de conexão ao criar pasta.');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const updateFolder = async () => {
    if (!editingFolder || !editFolderName.trim()) return;
    const { error } = await supabase.from('folders').update({ name: editFolderName.trim() }).eq('id', editingFolder.id);
    if (error) {
      toast.error('Erro ao editar pasta: ' + error.message);
      return;
    }
    setEditingFolder(null);
    setEditFolderName('');
    await loadFolder(currentFolderId);
    toast.success('Pasta renomeada');
  };

  const deleteFolder = async (id: string) => {
    if (!confirm('Excluir esta pasta e todo seu conteúdo?')) return;
    const { error } = await supabase.from('folders').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir pasta: ' + error.message);
      return;
    }
    await loadFolder(currentFolderId);
    toast.success('Pasta removida');
  };

  // ─── Material CRUD ──────────────────────────────────────────
  const deleteMaterial = async (id: string) => {
    if (!confirm('Excluir este material?')) return;
    const { error } = await supabase.from('materials').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir material: ' + error.message);
      return;
    }
    await loadFolder(currentFolderId);
    toast.success('Material removido');
  };

  const handleAddLink = async () => {
    if (!materialName.trim() || !materialUrl.trim()) {
      toast.error('Preencha o nome e o link');
      return;
    }

    let finalUrl = materialUrl.trim();
    if (!finalUrl.startsWith('http')) {
      finalUrl = 'https://' + finalUrl;
    }

    setIsAddingLink(true);
    try {
      const parent_val = currentFolderId ? currentFolderId : null;

      const response = await withTimeout(
        supabase.from('materials').insert({
          name: materialName.trim(),
          file_url: finalUrl,
          file_type: 'link',
          folder_id: parent_val,
          created_by: user?.id || null,
        }).select().single()
      );

      if (response.error) {
        toast.error('Erro ao adicionar link: ' + response.error.message);
        return;
      }

      setMaterialName('');
      setMaterialUrl('');
      setShowNewMaterial(false);
      await loadFolder(currentFolderId);
      toast.success('Material adicionado com sucesso');
    } catch (err: any) {
      toast.error('Erro de conexão: ' + err.message);
    } finally {
      setIsAddingLink(false);
    }
  };

  const openPresentation = (mat: MaterialItem) => {
    if (mat.file_url) {
      window.open(mat.file_url, '_blank');
    }
  };

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Materiais</h1>

          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm mt-2 flex-wrap">
            {breadcrumb.map((b, i) => (
              <span key={`${b.id ?? 'root'}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={14} className="text-muted-foreground/50" />}
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
                    i === breadcrumb.length - 1
                      ? 'text-primary font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                >
                  {i === 0 && <Home size={14} />}
                  {b.name}
                </button>
              </span>
            ))}
          </nav>
        </div>

        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowNewMaterial(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110 transition-all shadow-glow">
              <Plus size={16} /> Link do Google
            </button>
            <button onClick={() => { setShowNewFolder(true); setNewFolderName(''); }} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-foreground text-sm hover:bg-secondary/80 transition-colors">
              <Plus size={16} /> Pasta
            </button>
          </div>
        )}
      </div>

      {/* New Folder Form */}
      {showNewFolder && (
        <div className="glass-card p-4 flex gap-3 items-center">
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Nome da pasta"
            className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
            onKeyDown={(e) => { if (e.key === 'Enter' && !isCreatingFolder) createFolder(); }}
            disabled={isCreatingFolder}
            autoFocus
          />
          <button
            onClick={createFolder}
            disabled={isCreatingFolder || !newFolderName.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50 hover:brightness-110 transition-all"
          >
            {isCreatingFolder ? 'Criando...' : 'Criar'}
          </button>
          <button
            onClick={() => { setShowNewFolder(false); setNewFolderName(''); setIsCreatingFolder(false); }}
            className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm hover:bg-secondary/80"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Edit Folder Modal */}
      {editingFolder && (
        <div className="glass-card p-4 flex gap-3 items-center">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Renomear:</span>
          <input
            value={editFolderName}
            onChange={(e) => setEditFolderName(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
            onKeyDown={(e) => { if (e.key === 'Enter') updateFolder(); }}
            autoFocus
          />
          <button onClick={updateFolder} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Salvar</button>
          <button onClick={() => { setEditingFolder(null); setEditFolderName(''); }} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm">Cancelar</button>
        </div>
      )}

      {/* Add Google Drive Link Modal */}
      {showNewMaterial && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border border-border/40 rounded-xl overflow-hidden p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-display font-semibold text-foreground">Adicionar Material</h3>
              <button onClick={() => setShowNewMaterial(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Nome do Treinamento</label>
                <input value={materialName} onChange={e => setMaterialName(e.target.value)} placeholder="Ex: Treinamento NR-12" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Link do Google Drive</label>
                <input value={materialUrl} onChange={e => setMaterialUrl(e.target.value)} placeholder="https://docs.google.com/..." className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary" />
              </div>
            </div>
            <button onClick={handleAddLink} disabled={isAddingLink} className="w-full mt-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:brightness-110 transition-all disabled:opacity-50">
              {isAddingLink ? 'Adicionando...' : 'Adicionar Link'}
            </button>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showingQrFor && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowingQrFor(null)}>
          <div className="w-full max-w-sm bg-white rounded-xl overflow-hidden p-8 space-y-6 shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-gray-900 border-b pb-3">{showingQrFor.name}</h3>
            <p className="text-sm text-gray-600">Peça para os colaboradores escanearem este QR Code usando a câmera do celular para registrarem a assinatura do treinamento.</p>
            <div className="bg-gray-100 p-4 rounded-xl flex justify-center">
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(window.location.origin + '/sign?training=' + encodeURIComponent(showingQrFor.name))}`} alt="QR Code" className="w-48 h-48 border border-gray-200 rounded" />
            </div>
            <button onClick={() => setShowingQrFor(null)} className="w-full py-2 rounded-lg bg-gray-200 text-gray-900 font-medium hover:bg-gray-300 transition-colors">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>
      )}

      {/* Grid */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {/* Back button */}
          {currentFolderId !== null && (
            <button onClick={goBack} className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center">
              <ArrowLeft size={32} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Voltar</span>
            </button>
          )}

          {/* Folders */}
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center relative group cursor-pointer"
              onClick={() => navigateToFolder(folder)}
            >
              <Folder size={40} className="text-primary" />
              <span className="text-sm font-medium text-foreground">{folder.name}</span>
              {isAdmin && (
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); setEditingFolder(folder); setEditFolderName(folder.name); }} className="p-1.5 rounded-md bg-secondary text-muted-foreground hover:text-foreground">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); deleteFolder(folder.id); }} className="p-1.5 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30">
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Materials */}
          {materials.map((mat) => (
            <div key={mat.id} className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center relative group cursor-pointer" onClick={() => openPresentation(mat)}>
              <div className="p-3 bg-blue-500/10 rounded-xl">
                <FileText size={32} className="text-blue-500" />
              </div>
              <span className="text-sm font-medium text-foreground">{mat.name}</span>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button title="Gerar QR Code de Assinatura" onClick={(e) => { e.stopPropagation(); setShowingQrFor(mat); }} className="p-1.5 rounded-md bg-secondary text-foreground hover:bg-primary hover:text-primary-foreground transition-colors shadow-sm border border-border">
                  <QrCode size={14} />
                </button>
                {isAdmin && (
                  <button onClick={(e) => { e.stopPropagation(); deleteMaterial(mat.id); }} className="p-1.5 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30 border border-transparent shadow-sm">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && folders.length === 0 && materials.length === 0 && !currentFolderId && (
        <div className="glass-card p-12 text-center">
          <FolderOpen size={48} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Nenhum material ainda. {isAdmin ? 'Crie pastas e adicione links do Google Drive.' : 'Aguarde o administrador adicionar conteúdo.'}</p>
        </div>
      )}

      {!isLoading && folders.length === 0 && materials.length === 0 && currentFolderId && (
        <div className="glass-card p-12 text-center">
          <FolderOpen size={48} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Esta pasta está vazia.</p>
        </div>
      )}
    </div>
  );
}
