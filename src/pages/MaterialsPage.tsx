import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Folder, FileText, Plus, ArrowLeft, Edit2, Trash2, Upload, FolderOpen } from 'lucide-react';
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
  const [showNewMaterial, setShowNewMaterial] = useState(false);
  const [newMaterial, setNewMaterial] = useState({ name: '', description: '' });

  const fetchData = async (folderId: string | null) => {
    const [fRes, mRes] = await Promise.all([
      supabase.from('folders').select('*').eq('parent_id', folderId ?? '').is('parent_id', folderId === null ? null : undefined).order('name'),
      supabase.from('materials').select('*').eq('folder_id', folderId ?? '').is('folder_id', folderId === null ? null : undefined).order('name'),
    ]);

    // Fix query: re-fetch with proper filter
    const folderQuery = supabase.from('folders').select('*').order('name');
    const materialQuery = supabase.from('materials').select('*').order('name');

    if (folderId === null) {
      folderQuery.is('parent_id', null);
      materialQuery.is('folder_id', null);
    } else {
      folderQuery.eq('parent_id', folderId);
      materialQuery.eq('folder_id', folderId);
    }

    const [f2, m2] = await Promise.all([folderQuery, materialQuery]);
    setFolders(f2.data ?? []);
    setMaterials(m2.data ?? []);
  };

  useEffect(() => {
    fetchData(currentFolder);
  }, [currentFolder]);

  const navigateToFolder = (folder: FolderItem) => {
    setCurrentFolder(folder.id);
    setBreadcrumb(prev => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateToBreadcrumb = (index: number) => {
    const item = breadcrumb[index];
    setCurrentFolder(item.id);
    setBreadcrumb(breadcrumb.slice(0, index + 1));
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    await supabase.from('folders').insert({ name: newFolderName, parent_id: currentFolder, created_by: user?.id });
    setNewFolderName('');
    setShowNewFolder(false);
    fetchData(currentFolder);
    toast.success('Pasta criada');
  };

  const createMaterial = async () => {
    if (!newMaterial.name.trim()) return;
    await supabase.from('materials').insert({
      name: newMaterial.name,
      description: newMaterial.description,
      folder_id: currentFolder,
      created_by: user?.id,
    });
    setNewMaterial({ name: '', description: '' });
    setShowNewMaterial(false);
    fetchData(currentFolder);
    toast.success('Material criado');
  };

  const deleteFolder = async (id: string) => {
    await supabase.from('folders').delete().eq('id', id);
    fetchData(currentFolder);
    toast.success('Pasta removida');
  };

  const deleteMaterial = async (id: string) => {
    await supabase.from('materials').delete().eq('id', id);
    fetchData(currentFolder);
    toast.success('Material removido');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Materiais</h1>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <button onClick={() => navigateToBreadcrumb(i)} className="hover:text-primary transition-colors">
                  {b.name}
                </button>
              </span>
            ))}
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={() => setShowNewFolder(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-foreground text-sm hover:bg-secondary/80 transition-colors">
              <Plus size={16} /> Pasta
            </button>
            <button onClick={() => setShowNewMaterial(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:brightness-110 transition-all">
              <Plus size={16} /> Material
            </button>
          </div>
        )}
      </div>

      {/* New folder dialog */}
      {showNewFolder && (
        <div className="glass-card p-4 flex gap-3">
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Nome da pasta"
            className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
            onKeyDown={(e) => e.key === 'Enter' && createFolder()}
          />
          <button onClick={createFolder} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Criar</button>
          <button onClick={() => setShowNewFolder(false)} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm">Cancelar</button>
        </div>
      )}

      {showNewMaterial && (
        <div className="glass-card p-4 space-y-3">
          <input
            value={newMaterial.name}
            onChange={(e) => setNewMaterial(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Nome do material"
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
          />
          <input
            value={newMaterial.description}
            onChange={(e) => setNewMaterial(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Descrição (opcional)"
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <button onClick={createMaterial} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Criar</button>
            <button onClick={() => setShowNewMaterial(false)} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* Grid of folders and materials */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {currentFolder && (
          <button
            onClick={() => navigateToBreadcrumb(breadcrumb.length - 2)}
            className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center"
          >
            <ArrowLeft size={32} className="text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Voltar</span>
          </button>
        )}

        {folders.map((folder) => (
          <div key={folder.id} className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center relative group cursor-pointer" onClick={() => navigateToFolder(folder)}>
            <Folder size={40} className="text-primary" />
            <span className="text-sm font-medium text-foreground">{folder.name}</span>
            {isAdmin && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); deleteFolder(folder.id); }} className="p-1.5 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ))}

        {materials.map((mat) => (
          <div key={mat.id} className="glass-card-hover p-5 flex flex-col items-center gap-3 text-center relative group">
            <FileText size={40} className="text-blue-400" />
            <span className="text-sm font-medium text-foreground">{mat.name}</span>
            {mat.description && <span className="text-xs text-muted-foreground">{mat.description}</span>}
            {isAdmin && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => deleteMaterial(mat.id)} className="p-1.5 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {folders.length === 0 && materials.length === 0 && !currentFolder && (
        <div className="glass-card p-12 text-center">
          <FolderOpen size={48} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Nenhum material ainda. {isAdmin ? 'Crie pastas e materiais acima.' : 'Aguarde o administrador adicionar conteúdo.'}</p>
        </div>
      )}
    </div>
  );
}
