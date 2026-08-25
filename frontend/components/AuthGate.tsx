"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

const GUEST_KEY = "job_dekho_guest";

function isGuest() {
  return typeof window !== "undefined" && localStorage.getItem(GUEST_KEY) === "1";
}

// Supabase's client persists the session in localStorage synchronously, so a
// cached access token means we already know a session exists without waiting
// for the async getSession() round-trip - this avoids a loading flash on
// every single page navigation, which is the main perceived-speed cost of
// gating the whole app behind auth.
function hasCachedSession() {
  if (typeof window === "undefined") return false;
  try {
    return Object.keys(localStorage).some(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token") && !!localStorage.getItem(k)
    );
  } catch {
    return false;
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Both server and first client render must produce identical output, so
  // state starts unresolved here - localStorage is only read in
  // useLayoutEffect below, which runs after mount but before the browser
  // paints, so there is no visible flash despite avoiding an SSR mismatch.
  const [allowed, setAllowed] = useState(false);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (isGuest() || hasCachedSession()) {
      setAllowed(true);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let active = true;

    function evaluate(session: Session | null) {
      if (!active) return;
      const guest = isGuest();
      if (session || guest) {
        setAllowed(true);
      } else {
        setAllowed(false);
        router.replace("/login");
      }
      setReady(true);
    }

    supabase.auth.getSession().then(({ data }) => evaluate(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      evaluate(session);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  if (!ready && !allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading Smart Apply...</p>
      </div>
    );
  }

  return <>{children}</>;
}

export function markGuestSession() {
  if (typeof window !== "undefined") {
    localStorage.setItem(GUEST_KEY, "1");
  }
}

export { isGuest };

export async function signOutEverywhere() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(GUEST_KEY);
  }
  await supabase.auth.signOut();
}
