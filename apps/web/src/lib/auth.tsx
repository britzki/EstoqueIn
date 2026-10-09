import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, tokenStore } from './api';
import type { Permission, Session } from './types';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Inicia a sessão com um token já emitido (ex.: após a configuração inicial). */
  startSession: (data: Session & { token: string }) => void;
  /** Atualiza a sessão atual (ex.: depois de trocar a senha temporária). */
  updateSession: (data: Session) => void;
  logout: () => void;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(() => Boolean(tokenStore.get()));

  useEffect(() => {
    if (!tokenStore.get()) return;
    api
      .get<Session>('/auth/me')
      .then(setSession)
      // Só descarta o token se ele foi recusado; numa falha de rede ele continua valendo.
      .catch((error) => error instanceof ApiError && error.status === 401 && tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Sessão expirada ou usuário desativado: some também tudo o que estava em cache (faturamento,
    // relatórios), para o próximo a entrar neste computador não ver os números de outro usuário.
    const onUnauthorized = () => {
      queryClient.clear();
      setSession(null);
    };
    window.addEventListener('estoquein:unauthorized', onUnauthorized);
    return () => window.removeEventListener('estoquein:unauthorized', onUnauthorized);
  }, [queryClient]);

  const startSession = useCallback(
    ({ token, ...data }: Session & { token: string }) => {
      queryClient.clear();
      tokenStore.set(token);
      setSession(data);
    },
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      startSession(await api.post<Session & { token: string }>('/auth/login', { email, password }));
    },
    [startSession],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    queryClient.clear();
    setSession(null);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      login,
      startSession,
      updateSession: setSession,
      logout,
      can: (permission) => Boolean(session?.permissions.includes(permission)),
    }),
    [session, loading, login, startSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return context;
}
