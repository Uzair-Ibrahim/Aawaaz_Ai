'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AuthSessionUser, LanguageCode, ModuleManifest } from '@awaaz/shared';
import { apiRequest } from '../api/client';

export interface IntegrationsInfo {
  dataStoreMode: 'supabase' | 'memory';
  authMode: 'supabase' | 'dev_local';
  ai: { provider: string; configured: boolean; model: string; embeddingModel: string; reason?: string };
  voice: { provider: string; configured: boolean; reason?: string };
  otp?: { provider: string; configured: boolean; devLocalPreviewEnabled: boolean; reason?: string };
}

interface AuthContextValue {
  user: AuthSessionUser | null;
  token: string | null;
  activeOrganizationId: string | null;
  integrations: IntegrationsInfo | null;
  modules: ModuleManifest[];
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthSessionUser>;
  register: (input: {
    email: string;
    password: string;
    display_name: string;
    preferred_language?: LanguageCode;
  }) => Promise<AuthSessionUser>;
  setAuthenticatedSession: (accessToken: string, sessionUser: AuthSessionUser) => void;
  clearLocalAuthSession: () => void;
  logout: () => Promise<void>;
  switchWorkspace: (organizationId: string) => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_STORAGE_KEY = 'awaaz_access_token';
const ORG_STORAGE_KEY = 'awaaz_active_org_id';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsInfo | null>(null);
  const [modules, setModules] = useState<ModuleManifest[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async (tok: string | null, orgId: string | null) => {
    try {
      const health = await apiRequest<{ integrations: IntegrationsInfo; modules: ModuleManifest[] }>('/health');
      setIntegrations(health.integrations);
      setModules(health.modules);
    } catch {
      // Offline or backend unavailable
    }

    if (!tok) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const data = await apiRequest<{
        user: AuthSessionUser;
        integrations: IntegrationsInfo;
        modules: ModuleManifest[];
      }>('/auth/me', { token: tok, organizationId: orgId });
      setUser(data.user);
      setActiveOrganizationId(data.user.active_organization.id);
      setIntegrations(data.integrations);
      setModules(data.modules);
    } catch {
      setUser(null);
      setToken(null);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedToken = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null;
    const savedOrg = typeof window !== 'undefined' ? window.localStorage.getItem(ORG_STORAGE_KEY) : null;
    setToken(savedToken);
    setActiveOrganizationId(savedOrg);
    void loadSession(savedToken, savedOrg);
  }, [loadSession]);

  const login = useCallback(async (email: string, password: string): Promise<AuthSessionUser> => {
    const data = await apiRequest<{ access_token: string; user: AuthSessionUser }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setToken(data.access_token);
    setUser(data.user);
    setActiveOrganizationId(data.user.active_organization.id);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, data.access_token);
      window.localStorage.setItem(ORG_STORAGE_KEY, data.user.active_organization.id);
    }
    return data.user;
  }, []);

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      display_name: string;
      preferred_language?: LanguageCode;
    }): Promise<AuthSessionUser> => {
      const data = await apiRequest<{ access_token: string; user: AuthSessionUser }>('/auth/register', {
        method: 'POST',
        body: input,
      });
      setToken(data.access_token);
      setUser(data.user);
      setActiveOrganizationId(data.user.active_organization.id);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, data.access_token);
        window.localStorage.setItem(ORG_STORAGE_KEY, data.user.active_organization.id);
      }
      return data.user;
    },
    [],
  );

  const setAuthenticatedSession = useCallback((accessToken: string, sessionUser: AuthSessionUser) => {
    setToken(accessToken);
    setUser(sessionUser);
    setActiveOrganizationId(sessionUser.active_organization.id);
    if (typeof window !== 'undefined') {
      if (accessToken) window.localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
      window.localStorage.setItem(ORG_STORAGE_KEY, sessionUser.active_organization.id);
    }
  }, []);

  const clearLocalAuthSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setActiveOrganizationId(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(ORG_STORAGE_KEY);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST', token });
    } catch {
      // Ignore
    }
    clearLocalAuthSession();
  }, [token, clearLocalAuthSession]);

  const switchWorkspace = useCallback(
    async (organizationId: string) => {
      if (!token || !user || user.active_role === 'citizen') return;
      const prevOrgId = activeOrganizationId;
      try {
        const data = await apiRequest<{
          user: AuthSessionUser;
          integrations: IntegrationsInfo;
          modules: ModuleManifest[];
        }>('/auth/me', { token, organizationId });
        setUser(data.user);
        setActiveOrganizationId(data.user.active_organization.id);
        setIntegrations(data.integrations);
        setModules(data.modules);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(ORG_STORAGE_KEY, data.user.active_organization.id);
        }
      } catch {
        // Backend rejected unauthorized workspace switch; preserve previous valid workspace
        if (prevOrgId) {
          setActiveOrganizationId(prevOrgId);
        }
      }
    },
    [token, user, activeOrganizationId],
  );

  const refreshSession = useCallback(async () => {
    await loadSession(token, activeOrganizationId);
  }, [loadSession, token, activeOrganizationId]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        activeOrganizationId,
        integrations,
        modules,
        loading,
        login,
        register,
        setAuthenticatedSession,
        clearLocalAuthSession,
        logout,
        switchWorkspace,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
