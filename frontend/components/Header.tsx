"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GeminiKeyInput } from "@/components/GeminiKeyInput";
import { cn } from "@/lib/utils";
import { getApiKey, onApiKeyChange } from "@/lib/apiKeyStore";
import { supabase } from "@/lib/supabaseClient";
import { isGuest, signOutEverywhere } from "@/components/AuthGate";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

const NAV = [
  { href: "/matches", label: "Matches" },
  { href: "/browse", label: "Browse" },
  { href: "/applications", label: "Applications" },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [hasKey, setHasKey] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setHasKey(!!getApiKey());
    return onApiKeyChange(() => setHasKey(!!getApiKey()));
  }, []);

  useEffect(() => {
    function evaluate(hasSession: boolean) {
      setSignedIn(hasSession || isGuest());
    }

    supabase.auth.getSession().then(({ data }) => evaluate(!!data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      evaluate(!!session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await signOutEverywhere();
    setSignedIn(false);
    toast.success("Signed out");
    router.push("/login");
  }

  return (
    <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
      <div className="w-full grid grid-cols-[1fr_auto_1fr] items-center px-6 py-4 gap-6">
        <Link
          href="/matches"
          className="flex items-center font-display font-normal text-2xl shrink-0 text-foreground"
          style={{ letterSpacing: "0.04em" }}
        >
          Smart<span className="font-medium text-primary">Apply</span>
        </Link>
        <nav className="flex items-center gap-6 justify-self-center text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "font-medium transition-colors",
                pathname === item.href
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 justify-self-end">
          <span
            className={cn(
              "hidden sm:inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-border",
              hasKey ? "text-good" : "text-warn"
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", hasKey ? "bg-good" : "bg-warn")}
              style={{ backgroundColor: hasKey ? "var(--good)" : "var(--warn)" }}
            />
            {hasKey ? "AI key connected" : "No API key"}
          </span>
          <GeminiKeyInput />
          {signedIn ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="hidden sm:inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          ) : (
            <Link
              href="/login"
              className="hidden sm:inline-flex text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
