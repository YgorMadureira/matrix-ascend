import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Folder, FileText, Plus, ArrowLeft, Edit2, Trash2, Upload, FolderOpen, X, Maximize2 } from 'lucide-react';
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

export default function MaterialsPage() {
  const { isAdmin, user } = useAuth();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'Raiz' }]);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolder, setEditingFolder] = useState<FolderItem | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [viewingFile, setViewingFile] = useState<MaterialItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  const fetchData = async (folderId: string | null) => {
    let folderResult;
    let materialResult;

    if (folderId === null) {
      folderResult = await supabase.from('folders').select('*').is('parent_id', null).order('name');
      materialResult = await supabase.from('materials').select('*').is('folder_id', null).order('name');
    } else {
      folderResult = await supabase.from('folders').select('*').eq('parent_id', folderId).order('name');
      materialResult = await supabase.from('materials').select('*').eq('folder_id', folderId).order('name');
    }

    console.log('fetchData folderId:', folderId, 'folders:', folderResult.data, 'error:', folderResult.error);
    setFolders(folderResult.data ?? []);
    setMaterials(materialResult.data ?? []);
  };

  useEffect(() => { fetchData(currentFolder); }, [currentFolder]);

  const navigateToFolder = (folder: FolderItem) => {
    setBreadcrumb(prev => {
      if (prev[prev.length - 1].id === folder.id) return prev;
      return [...prev, { id: folder.id, name: folder.name }];
    });
    setCurrentFolder(folder.id);
  };

  const navigateToBreadcrumb = (index: number) => {
    const item = breadcrumb[index];
    setCurrentFolder(item.id);
    setBreadcrumb(prev => prev.slice(0, index + 1));
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    const insertData: { name: string; parent_id: string | null } = {
      name: newFolderName,
      parent_id: currentFolder,
    };
    const { error } = await supabase.from('folders').insert(insertData);
    if (error) {
      toast.error('Erro ao criar pasta: ' + error.message);
      return;
    }
    setNewFolderName('');
    setShowNewFolder(false);
    fetchData(currentFolder);
    toast.success('Pasta criada');
  };

  const updateFolder = async () => {
    if (!editingFolder || !editFolderName.trim()) return;
    const { error } = await supabase.from('folders').update({ name: editFolderName }).eq('id', editingFolder.id);
    if (error) {
      toast.error('Erro ao editar pasta: ' + error.message);
      return;
    }
    setEditingFolder(null);
    setEditFolderName('');
    fetchData(currentFolder);
    toast.success('Pasta renomeada');
  };

  const deleteFolder = async (id: string) => {
    if (!confirm('Excluir esta pasta e todo seu conteúdo?')) return;
    const { error } = await supabase.from('folders').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir pasta: ' + error.message);
      return;
    }
    fetchData(currentFolder);
    toast.success('Pasta removida');
  };

  const deleteMaterial = async (id: string) => {
    if (!confirm('Excluir este material?')) return;
    const { error } = await supabase.from('materials').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir material: ' + error.message);
      return;
    }
    fetchData(currentFolder);
    toast.success('Material removido');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = [
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];

    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(ppt|pptx)$/i)) {
      toast.error('Apenas arquivos PowerPoint (.ppt, .pptx) são permitidos');
      return;
    }

    setUploading(true);
    const path = `materials/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from('signatures').upload(path, file, { upsert: true });
    
    if (uploadError) {
      toast.error('Erro no upload: ' + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('signatures').getPublicUrl(path);
    
    await supabase.from('materials').insert({
      name: file.name.replace(/\.(pptx?)/i, ''),
      file_url: urlData.publicUrl,
      file_type: 'powerpoint',
      folder_id: currentFolder,
      created_by: user?.id,
    });

    fetchData(currentFolder);
    setUploading(false);
    toast.success('Apresentação enviada');
    e.target.value = '';
  };

  const openPresentation = (mat: MaterialItem) => {
    if (mat.file_url) {
      setViewingFile(mat);
    }
  };

  const toggleFullscreen = () => {
    if (viewerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        viewerRef.current.requestFullscreen();
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Materiais</h1>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <button onClick={() => navigateToBreadcrumb(i)} className="hover:text-primary transition-colors">{b.name}</button>
              </span>
            ))}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <label className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110 transition-all cursor-pointer">
            <Upload size={16} /> {uploading ? 'Enviando...' : 'Upload PPTX'}
            <input type="file" accept=".ppt,.pptx" onChange={handleFileUpload} className="hidden" disabled={uploading} />
          </label>
          <button onClick={() => setShowNewFolder(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-foreground text-sm hover:bg-secondary/80 transition-colors">
            <Plus size={16} /> Pasta
          </button>
        </div>
      </div>

      {/* New folder */}
      {showNewFolder && (
        <div className="glass-card p-4 flex gap-3">
          <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Nome da pasta"
            className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
            onKeyDown={(e) => e.key === 'Enter' && createFolder()} />
          <button onClick={createFolder} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Criar</button>
          <button onClick={() => setShowNewFolder(false)} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm">Cancelar</button>
        </div>
      )}

      {/* Edit folder */}
      {editingFolder && (
        <div className="glass-card p-4 flex gap-3">
          <input value={editFolderName} onChange={(e) => setEditFolderName(e.target.value)} placeholder="Novo nome"
            className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
            onKeyDown={(e) => e.key === 'Enter' && updateFolder()} />
          <button onClick={updateFolder} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Salvar</button>
          <button onClick={() => setEditingFolder(null)} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm">Cancelar</button>
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

        {folders.map((folder) => (
          <div key={folder.id} className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center relative group cursor-pointer" onClick={() => navigateToFolder(folder)}>
            <Folder size={40} className="text-primary" />
            <span className="text-sm font-medium text-foreground">{folder.name}</span>
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={(e) => { e.stopPropagation(); setEditingFolder(folder); setEditFolderName(folder.name); }} className="p-1.5 rounded-md bg-secondary text-muted-foreground hover:text-foreground">
                <Edit2 size={14} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); deleteFolder(folder.id); }} className="p-1.5 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}

        {materials.map((mat) => (
          <div key={mat.id} className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center relative group cursor-pointer" onClick={() => openPresentation(mat)}>
            <FileText size={40} className="text-blue-400" />
            <span className="text-sm font-medium text-foreground">{mat.name}</span>
            {mat.file_type === 'powerpoint' && <span className="text-[10px] text-primary font-medium">PPTX</span>}
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={(e) => { e.stopPropagation(); deleteMaterial(mat.id); }} className="p-1.5 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {folders.length === 0 && materials.length === 0 && !currentFolder && (
        <div className="glass-card p-12 text-center">
          <FolderOpen size={48} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Nenhum material ainda. {isAdmin ? 'Crie pastas e faça upload de apresentações.' : 'Aguarde o administrador adicionar conteúdo.'}</p>
        </div>
      )}

      {/* Presentation Viewer Modal */}
      {viewingFile && viewingFile.file_url && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div ref={viewerRef} className="w-full max-w-6xl h-[85vh] bg-card rounded-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-border/40">
              <h3 className="text-sm font-medium text-foreground truncate">{viewingFile.name}</h3>
              <div className="flex gap-2">
                <button onClick={toggleFullscreen} className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                  <Maximize2 size={18} />
                </button>
                <button onClick={() => setViewingFile(null)} className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1">
              <iframe
                src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(viewingFile.file_url)}`}
                className="w-full h-full border-0"
                title={viewingFile.name}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
