import React, { createContext, useContext, useState } from 'react';
import api from '../api';

interface AuthContextType {
  userId: string | null;
  teamId: string | null;
  role: string | null;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(localStorage.getItem('userId'));
  const [teamId, setTeamId] = useState<string | null>(localStorage.getItem('teamId'));
  const [role, setRole] = useState<string | null>(localStorage.getItem('role'));
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem('accessToken'));

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('userId', data.userId);
    localStorage.setItem('teamId', data.teamId);
    localStorage.setItem('role', data.role);
    setAccessToken(data.accessToken);
    setUserId(data.userId);
    setTeamId(data.teamId);
    setRole(data.role);
  }

  function logout() {
    localStorage.clear();
    setAccessToken(null);
    setUserId(null);
    setTeamId(null);
    setRole(null);
  }

  return (
    <AuthContext.Provider value={{ userId, teamId, role, accessToken, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
