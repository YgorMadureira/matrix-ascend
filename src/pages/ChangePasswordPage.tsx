import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function ChangePasswordPage({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const isStrong = newPassword.length >= 6;

  const handleSubmit = async () => {
    if (!newPassword.trim()) {
      toast.error('Digite a nova senha.');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('A senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem.');
      return;
    }

    setSaving(true);
    try {
      // 1. Atualizar a senha no Supabase Auth
      const { error: pwErr } = await supabase.auth.updateUser({ password: newPassword });
      if (pwErr) throw new Error(pwErr.message);

      // 2. Remover a flag de "must_change_password" do metadata
      const { error: metaErr } = await supabase.auth.updateUser({
        data: { must_change_password: false }
      });
      if (metaErr) console.warn('[ChangePassword] Aviso ao remover flag:', metaErr.message);

      toast.success('✅ Senha redefinida com sucesso! Bem-vindo à plataforma.');
      onDone();
    } catch (err: any) {
      toast.error('Erro ao redefinir senha: ' + (err.message || 'Tente novamente.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-[#FEF6F5] flex items-center justify-center p-4">
      {/* Top brand bar */}
      <div className="fixed top-0 left-0 w-full h-1 bg-gradient-to-r from-[#EE4D2D] to-[#FF7337]" />

      <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#EE4D2D] shadow-xl shadow-[#EE4D2D]/30 mb-4">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Redefinição de Senha</h1>
          <p className="text-sm text-gray-500 font-medium mt-1.5 max-w-xs mx-auto leading-relaxed">
            Este é seu primeiro acesso. Por segurança, crie uma senha pessoal antes de continuar.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 space-y-5">
          {/* Current user info */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div className="w-8 h-8 rounded-full bg-[#EE4D2D] flex items-center justify-center text-white text-sm font-black">
              {(user?.email ?? 'U')[0].toUpperCase()}
            </div>
            <span className="text-xs font-bold text-gray-500 truncate">{user?.email}</span>
          </div>

          {/* Nova senha */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nova Senha</label>
            <div className="relative">
              <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className={`w-full pl-10 pr-11 py-3.5 rounded-xl bg-gray-50 border-2 text-gray-800 text-sm font-bold outline-none focus:bg-white transition-all ${
                  confirmPassword && passwordsMismatch
                    ? 'border-red-200 focus:border-red-300'
                    : passwordsMatch
                    ? 'border-emerald-200 focus:border-emerald-300'
                    : 'border-transparent focus:border-[#EE4D2D]/30'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {/* Força da senha */}
            {newPassword.length > 0 && (
              <div className="flex items-center gap-2 ml-1 mt-1">
                <div className="flex gap-1">
                  {[1,2,3].map(i => (
                    <div
                      key={i}
                      className={`h-1 w-8 rounded-full transition-all ${
                        newPassword.length >= i * 4
                          ? i === 1 ? 'bg-red-400' : i === 2 ? 'bg-amber-400' : 'bg-emerald-400'
                          : 'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
                <span className={`text-[9px] font-black uppercase tracking-wider ${
                  newPassword.length < 4 ? 'text-red-400' : newPassword.length < 8 ? 'text-amber-500' : 'text-emerald-500'
                }`}>
                  {newPassword.length < 4 ? 'Fraca' : newPassword.length < 8 ? 'Média' : 'Forte'}
                </span>
              </div>
            )}
          </div>

          {/* Confirmar senha */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Confirmar Nova Senha</label>
            <div className="relative">
              <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repita a nova senha"
                className={`w-full pl-10 pr-11 py-3.5 rounded-xl bg-gray-50 border-2 text-gray-800 text-sm font-bold outline-none focus:bg-white transition-all ${
                  passwordsMismatch
                    ? 'border-red-200 focus:border-red-300'
                    : passwordsMatch
                    ? 'border-emerald-200 focus:border-emerald-300'
                    : 'border-transparent focus:border-[#EE4D2D]/30'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {passwordsMismatch && (
              <p className="text-[9px] text-red-500 font-bold ml-1">❌ As senhas não coincidem</p>
            )}
            {passwordsMatch && (
              <p className="text-[9px] text-emerald-500 font-bold ml-1">✅ Senhas coincidem</p>
            )}
          </div>

          {/* Submit */}
          <button
            disabled={saving || !isStrong || !passwordsMatch}
            onClick={handleSubmit}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-[#EE4D2D] to-[#FF7337] text-white font-black text-xs uppercase tracking-[0.2em] shadow-lg shadow-[#EE4D2D]/25 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed mt-2"
          >
            {saving ? 'SALVANDO...' : 'CONFIRMAR E ENTRAR'}
          </button>

          <p className="text-center text-[9px] text-gray-400 font-medium">
            Esta senha é pessoal e intransferível. Não compartilhe com ninguém.
          </p>
        </div>
      </div>
    </div>
  );
}
