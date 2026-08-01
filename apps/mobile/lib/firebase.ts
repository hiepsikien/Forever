import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  Auth,
  GoogleAuthProvider,
  PhoneAuthProvider,
  getAuth,
  signInWithCredential,
} from "firebase/auth";

type Extra = {
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseAppId?: string;
  firebaseMessagingSenderId?: string;
  googleWebClientId?: string;
  googleIosClientId?: string;
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

export function googleWebClientId(): string {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ||
    extra().googleWebClientId?.trim() ||
    ""
  );
}

export function googleIosClientId(): string {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ||
    extra().googleIosClientId?.trim() ||
    ""
  );
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
  auth = getAuth(app);
  // Keep AsyncStorage import so Expo tree-shaking keeps the dependency for future RN persistence.
  void AsyncStorage;
  return auth;
}

export async function signInWithGoogleIdToken(idToken: string) {
  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(getFirebaseAuth(), credential);
}

export async function confirmPhoneCode(verificationId: string, code: string) {
  const credential = PhoneAuthProvider.credential(verificationId, code);
  return signInWithCredential(getFirebaseAuth(), credential);
}

export async function firebaseIdToken(): Promise<string | null> {
  const current = getFirebaseAuth().currentUser;
  if (!current) return null;
  return current.getIdToken();
}

export async function firebaseSignOut() {
  if (!isFirebaseConfigured()) return;
  await getFirebaseAuth().signOut();
}
