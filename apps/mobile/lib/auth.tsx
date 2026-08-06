import {
  ForeverApi,
  SessionUser,
} from "@forever/api-client";
import { onIdTokenChanged } from "firebase/auth";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createMobileApi,
  getStoredToken,
  resolveAuthToken,
  setStoredToken,
} from "./api";
import {
  firebaseSignOut,
  getFirebaseAuth,
  isFirebaseConfigured,
  sendPasswordReset,
  signInWithEmail,
} from "./firebase";

type AuthContextValue = {
  user: SessionUser | null;
  api: ForeverApi;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInDev: (email: string, password: string, name?: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Dev-mode JWTs have no issuer to refresh them, so they still live in SecureStore.
  const [devToken, setDevToken] = useState<string | null>(null);
  const devTokenRef = useRef<string | null>(null);
  devTokenRef.current = devToken;

  /**
   * Firebase ID tokens expire hourly. Asking the SDK on every request lets it
   * hand back a cached token and silently refresh an expired one, so a phone
   * left idle overnight still works in the morning.
   */
  const getToken = useCallback(
    async () => (await resolveAuthToken()) ?? devTokenRef.current,
    [],
  );

  const api = useMemo(() => createMobileApi(getToken), [getToken]);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    }
  }, [api, getToken]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const stored = await getStoredToken();
      if (cancelled) return;
      if (stored) {
        setDevToken(stored);
        devTokenRef.current = stored;
      }

      if (!isFirebaseConfigured()) {
        await refresh();
        if (!cancelled) setLoading(false);
        return;
      }

      // Fires once Firebase has restored the persisted session, then on every
      // token refresh — that first call is what keeps mẹ signed in across restarts.
      unsubscribe = onIdTokenChanged(getFirebaseAuth(), async (fbUser) => {
        if (cancelled) return;
        if (fbUser) {
          try {
            setUser((await api.establishSession()).user);
          } catch {
            setUser(null);
          }
        } else if (devTokenRef.current) {
          await refresh();
        } else {
          setUser(null);
        }
        if (!cancelled) setLoading(false);
      });
      if (cancelled) unsubscribe();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmail(email, password);
    // onIdTokenChanged establishes the Forever session; await it here so the
    // caller can show an error instead of a blank screen.
    setUser((await api.establishSession()).user);
  };

  const signInDev = async (email: string, password: string, name?: string) => {
    const res = await api.login(email, password, name);
    await setStoredToken(res.token);
    setDevToken(res.token);
    setUser(res.user);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordReset(email);
  };

  const signOut = async () => {
    try {
      if (isFirebaseConfigured()) await firebaseSignOut();
    } catch {
      // A failed remote sign-out must not strand the user in the app.
    }
    await setStoredToken(null);
    setDevToken(null);
    setUser(null);
  };

  const value: AuthContextValue = {
    user,
    api,
    loading,
    signIn,
    signInDev,
    resetPassword,
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
