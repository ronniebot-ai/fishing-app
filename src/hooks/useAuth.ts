import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'tideline-auth';

// A stand-in for real accounts: one admin, checked in the browser. There is
// nothing behind this on the server — the API still accepts writes from
// anyone — so it gates the button, not the data. Good enough to demonstrate
// the login flow without building out accounts the app does not otherwise need.
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';

// `localStorage` fires no event for a write made in the same tab that reads
// it, so `login`/`logout` notify this by hand — the same shape useMode.ts
// uses for matchMedia, minus the browser doing the notifying for us.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1';
}

/** The server has no localStorage; "logged out" is the only safe guess. */
function getServerSnapshot(): boolean {
  return false;
}

function setStored(loggedIn: boolean): void {
  if (loggedIn) localStorage.setItem(STORAGE_KEY, '1');
  else localStorage.removeItem(STORAGE_KEY);
  for (const listener of listeners) listener();
}

export interface Auth {
  loggedIn: boolean;
  /** Returns whether the credentials were accepted. */
  login: (username: string, password: string) => boolean;
  logout: () => void;
}

/**
 * Whether this browser is "logged in", remembered across visits the same way
 * a saved spot is — in `localStorage`, not a server session.
 */
export function useAuth(): Auth {
  const loggedIn = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const login = useCallback((username: string, password: string): boolean => {
    const ok = username === ADMIN_USER && password === ADMIN_PASS;
    if (ok) setStored(true);
    return ok;
  }, []);

  const logout = useCallback(() => setStored(false), []);

  return { loggedIn, login, logout };
}
