"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { getStats, type JobStats } from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";
import { markGuestSession } from "@/components/AuthGate";

const FEATURES = [
  { num: "01", title: "Explainable match scores", body: "See exactly why a role fits, not just a number." },
  { num: "02", title: "Skill gaps, priced", body: "Learn what unlocks the most roles for you." },
  { num: "03", title: "Interview prep on demand", body: "Role-specific questions before you apply." },
  { num: "04", title: "Applications tracked", body: "Your whole search in one place." },
];

export default function LoginPage() {
  const router = useRouter();
  const [stats, setStats] = useState<JobStats | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("Account created. Let's find your matches.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back.");
      }
      router.push("/matches");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function continueAsGuest() {
    markGuestSession();
    router.push("/matches");
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6 flex flex-col gap-5">
      <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
        <Link
          href="/"
          className="font-display text-foreground"
          style={{ fontSize: 17, letterSpacing: "0.04em" }}
        >
          Smart<span className="font-medium text-primary">Apply</span>
        </Link>
        <div className="flex-1 h-px bg-border mx-5" />
        <span>{mode === "signup" ? "Create account" : "Sign in"}</span>
      </div>

      <div className="flex-1 panel-flat overflow-hidden grid lg:grid-cols-[1.1fr_0.9fr]">
        {/* pitch */}
        <div className="p-8 sm:p-11 flex flex-col">
          <p className="text-[11px] tracking-[0.2em] uppercase text-[var(--gold-dim)]">
            Stop applying blindly
          </p>
          <h1
            className="font-display font-light mt-4"
            style={{ fontSize: 44, lineHeight: 1.06 }}
          >
            Skip the noise. <span className="text-[var(--gold-dim)]">Find your fit.</span>
          </h1>
          <p
            className="text-muted-foreground max-w-md"
            style={{ fontSize: 14, lineHeight: 1.8, marginTop: 18 }}
          >
            We scan seven job boards so you don&apos;t have to, then measure every open role
            against your real resume. You only spend time on applications worth sending.
          </p>

          <div style={{ marginTop: 26 }}>
            {FEATURES.map((f) => (
              <div
                key={f.num}
                className="grid grid-cols-[30px_1fr] gap-3.5 border-t border-border"
                style={{ padding: "15px 0" }}
              >
                <span
                  className="font-display text-[var(--gold-dim)]"
                  style={{ fontSize: 19, lineHeight: 1.2 }}
                >
                  {f.num}
                </span>
                <div>
                  <p className="font-semibold" style={{ fontSize: 14 }}>{f.title}</p>
                  <p
                    className="text-muted-foreground mt-1"
                    style={{ fontSize: 12.5, lineHeight: 1.55 }}
                  >
                    {f.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {stats && (
            <div className="flex gap-6 mt-auto pt-6 border-t border-border">
              <div>
                <p className="font-display font-light" style={{ fontSize: 30, lineHeight: 1 }}>
                  {stats.unique_jobs.toLocaleString()}
                </p>
                <p className="text-muted-foreground mt-1" style={{ fontSize: 11.5 }}>Live roles</p>
              </div>
              <div>
                <p className="font-display font-light" style={{ fontSize: 30, lineHeight: 1 }}>
                  {stats.companies_hiring.toLocaleString()}
                </p>
                <p className="text-muted-foreground mt-1" style={{ fontSize: 11.5 }}>Companies hiring</p>
              </div>
              <div>
                <p className="font-display font-light" style={{ fontSize: 30, lineHeight: 1 }}>
                  {stats.sources_aggregated}
                </p>
                <p className="text-muted-foreground mt-1" style={{ fontSize: 11.5 }}>Boards searched</p>
              </div>
            </div>
          )}
        </div>

        {/* form */}
        <div
          className="p-8 sm:p-10 flex flex-col justify-center relative overflow-hidden"
          style={{ background: "linear-gradient(205deg, oklch(0.185 0.007 55), oklch(0.1 0.004 55) 78%)" }}
        >
          <svg
            className="absolute -top-20 -right-20 opacity-[0.06] pointer-events-none"
            width="320"
            height="320"
            viewBox="0 0 320 320"
          >
            <g stroke="currentColor" fill="none" strokeWidth="1">
              <circle cx="160" cy="160" r="132" />
              <circle cx="160" cy="160" r="98" />
              <circle cx="160" cy="160" r="64" />
              <line x1="160" y1="28" x2="160" y2="64" />
              <line x1="160" y1="256" x2="160" y2="292" />
              <line x1="28" y1="160" x2="64" y2="160" />
              <line x1="256" y1="160" x2="292" y2="160" />
              <line x1="66" y1="66" x2="92" y2="92" />
              <line x1="228" y1="228" x2="254" y2="254" />
              <line x1="254" y1="66" x2="228" y2="92" />
              <line x1="92" y1="228" x2="66" y2="254" />
            </g>
          </svg>

          <div className="relative z-10 max-w-[330px] w-full mx-auto">
            <div className="flex border border-border mb-6 text-sm">
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`flex-1 text-center py-2.5 font-medium transition-colors ${
                  mode === "signup" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                Create account
              </button>
              <button
                type="button"
                onClick={() => setMode("signin")}
                className={`flex-1 text-center py-2.5 font-medium transition-colors ${
                  mode === "signin" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                Sign in
              </button>
            </div>

            <h2 className="font-display font-light" style={{ fontSize: 28, lineHeight: 1.15 }}>
              {mode === "signup" ? "Get your first match" : "Welcome back"}
            </h2>
            <p
              className="text-muted-foreground mt-2"
              style={{ fontSize: 13, lineHeight: 1.6 }}
            >
              {mode === "signup"
                ? "Save your matches, bookmarks and applications across sessions."
                : "Pick up your saved matches and tracked applications."}
            </p>

            <form className="space-y-5 mt-5" onSubmit={handleSubmit}>
              <div>
                <label className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground block mb-2">
                  Email
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  className="w-full bg-black/25 border border-border text-foreground px-3.5 py-2.5 text-sm rounded-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground block mb-2">
                  Password
                </label>
                <input
                  type="password"
                  placeholder="At least 6 characters"
                  className="w-full bg-black/25 border border-border text-foreground px-3.5 py-2.5 text-sm rounded-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-primary-foreground py-3 text-sm font-semibold rounded-sm hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {submitting ? "One sec..." : mode === "signup" ? "Create free account" : "Sign in"}
              </button>
            </form>

            <button
              type="button"
              onClick={continueAsGuest}
              className="block w-full text-center text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 mt-4 transition-colors"
            >
              Continue without an account
            </button>
            <p className="text-[11.5px] text-muted-foreground/70 text-center mt-5 leading-relaxed">
              Free to use. Bring your own AI key, stored only in your browser.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
