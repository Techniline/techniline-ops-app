"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabaseClient";
import type { UserProfile } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadProfile(currentUser: User | null): Promise<void> {
      if (!currentUser) {
        if (active) setProfile(null);
        return;
      }

      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (!active) return;

      if (error) {
        setProfile(null);
        return;
      }

      setProfile(data ?? null);
    }

    async function init(): Promise<void> {
      const { data } = await supabase.auth.getSession();
      if (!active) return;

      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      await loadProfile(sessionUser);

      if (active) setLoading(false);
    }

    void init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session: Session | null) => {
        const sessionUser = session?.user ?? null;
        setUser(sessionUser);
        void loadProfile(sessionUser);
      }
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, profile, loading, signOut }),
    [user, profile, loading, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
