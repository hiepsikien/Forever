import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  Auth,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";

type Extra = {
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseAppId?: string;
  firebaseMessagingSenderId?: string;
  authDev?: boolean;
};

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

export function isFirebaseConfigured(): boolean {
  const e = extra();
  return Boolean(
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim() || e.firebaseApiKey?.trim(),
  );
}

export function isAuthDevEnabled(): boolean {
  const fromEnv = process.env.EXPO_PUBLIC_AUTH_DEV?.trim().toLowerCase();
  if (fromEnv === "false" || fromEnv === "0") return false;
  if (fromEnv === "true" || fromEnv === "1") return true;
  const e = extra();
  if (typeof e.authDev === "boolean") return e.authDev;
  return true;
}

let auth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase chưa được cấu hình trên mobile.");
  }

  const config = {
    apiKey:
      process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim() || extra().firebaseApiKey || "",
    authDomain:
      process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ||
      extra().firebaseAuthDomain ||
      "",
    projectId:
      process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
      extra().firebaseProjectId ||
      "",
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim() || extra().firebaseAppId || "",
    messagingSenderId:
      process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() ||
      extra().firebaseMessagingSenderId ||
      "",
  };

  const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config);
  // Without AsyncStorage persistence the session dies with the process, so mẹ
  // would retype her password every time she opens the app.
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // initializeAuth throws if it already ran for this app (fast refresh).
    auth = getAuth(app);
  }
  return auth;
}

export async function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(getFirebaseAuth(), email, password);
}

export async function sendPasswordReset(email: string) {
  return sendPasswordResetEmail(getFirebaseAuth(), email);
}

export async function firebaseIdToken(
  forceRefresh = false,
): Promise<string | null> {
  const current = getFirebaseAuth().currentUser;
  if (!current) return null;
  return current.getIdToken(forceRefresh);
}

export async function firebaseSignOut() {
  if (!isFirebaseConfigured()) return;
  await getFirebaseAuth().signOut();
}
