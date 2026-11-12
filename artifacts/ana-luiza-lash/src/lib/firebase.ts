import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);

const app = hasFirebaseConfig
  ? getApps().length
    ? getApp()
    : initializeApp(config)
  : null;

export const adminAuth: Auth | null = app ? getAuth(app) : null;
export const firestore: Firestore | null = app ? getFirestore(app) : null;
export const firebaseReady = Boolean(adminAuth);

export function requireAdminAuth(): Auth {
  if (!adminAuth) {
    throw new Error(
      "Configure as variáveis VITE_FIREBASE_* antes de entrar no painel.",
    );
  }
  return adminAuth;
}

export function requireFirestore(): Firestore {
  if (!firestore) {
    throw new Error(
      "Configure as variáveis VITE_FIREBASE_* antes de conectar ao Firestore.",
    );
  }
  return firestore;
}
