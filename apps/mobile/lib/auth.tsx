import {
  ForeverApi,
  SessionUser,
} from "@forever/api-client";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { createMobileApi, getStoredToken, setStoredToken } from "./api";
import { firebaseSignOut, isFirebaseConfigured } from "./firebase";
import { nativeGoogleSignOut } from "./googleSignIn";

type AuthContextValue = {
  user: SessionUser | null;
  api: ForeverApi;
  loading: boolean;
  signInDev: (email: string, password: string, name?: string) => Promise<void>;
  signInWithIdToken: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const api = useMemo(
    () => createMobileApi(async () => token ?? (await getStoredToken())),
    [token],
  );

  const refresh = async () => {
    const stored = await getStoredToken();
    setToken(stored);
    if (!stored) {
      setUser(null);
      return;
    }
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      await setStoredToken(null);
      setToken(null);
      setUser(null);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInDev = async (email: string, password: string, name?: string) => {
    const res = await api.login(email, password, name);
    await setStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
  };

  const signInWithIdToken = async (idToken: string) => {
    await setStoredToken(idToken);
    setToken(idToken);
    const session = await createMobileApi(async () => idToken).establishSession();
    setUser(session.user);
  };

  const signOut = async () => {
    await nativeGoogleSignOut();
    try {
      if (isFirebaseConfigured()) await firebaseSignOut();
    } catch {
      // ignore
    }
    await setStoredToken(null);
    setToken(null);
    setUser(null);
  };

  const value: AuthContextValue = {
    user,
    api,
    loading,
    signInDev,
    signInWithIdToken,
    signOut,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
