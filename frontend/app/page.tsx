"use client";

import Link from "next/link";
import { HIRING_LOGOS, LogoMark } from "@/lib/hiringLogos";

const FEATURES = [
  {
    num: "01",
    title: "Ranked against your resume",
    body: "Skills you hold, seniority, and how closely the posting reads like your actual work. Not keyword soup.",
  },
  {
    num: "02",
    title: "The gap, priced",
    body: "Which skills are missing, and how many more roles each one would open for you.",
  },
  {
    num: "03",
    title: "Your bullets, rewritten",
    body: "Tailored to the posting and grounded in what your resume already says. Nothing invented.",
  },
  {
    num: "04",
    title: "The conversation, prepped",
    body: "A salary range for your level and mock interview questions for that specific role.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="px-6 py-6 space-y-5">
        {/* top bar */}
        <div className="flex items-center justify-between text-sm text-muted-foreground pb-1">
          <span className="font-display text-2xl text-foreground" style={{ letterSpacing: "0.04em" }}>
            Smart<span className="font-medium text-primary">Apply</span>
          </span>
          <div className="flex-1 h-px bg-border mx-5" />
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline">Skip the noise. Find your fit.</span>
            <Link href="/login" className="text-primary hover:text-foreground transition-colors font-medium">
              Sign in
            </Link>
          </div>
        </div>

        {/* hero - values ported directly from Main.dc.html's .hero / .fig rules */}
        <div className="panel-flat overflow-hidden grid md:grid-cols-[1.08fr_0.92fr] min-h-[410px] relative">
          {/* gear line-art sits behind the headline on the LEFT, per the artboard */}
          <svg
            className="absolute pointer-events-none"
            style={{ top: -80, left: -70 }}
            width="380"
            height="380"
            viewBox="0 0 380 380"
          >
            <g stroke="oklch(1 0 0 / 0.055)" fill="none" strokeWidth="1">
              <circle cx="190" cy="190" r="158" />
              <circle cx="190" cy="190" r="118" />
              <circle cx="190" cy="190" r="78" />
              <line x1="190" y1="32" x2="190" y2="74" />
              <line x1="190" y1="306" x2="190" y2="348" />
              <line x1="32" y1="190" x2="74" y2="190" />
              <line x1="306" y1="190" x2="348" y2="190" />
              <line x1="78" y1="78" x2="108" y2="108" />
              <line x1="272" y1="272" x2="302" y2="302" />
              <line x1="302" y1="78" x2="272" y2="108" />
              <line x1="108" y1="272" x2="78" y2="302" />
            </g>
          </svg>

          <div className="flex flex-col relative z-[2]" style={{ padding: "44px 42px" }}>
            <p className="uppercase text-[var(--gold-dim)]" style={{ fontSize: 11, letterSpacing: "0.2em" }}>
              Stop applying blindly
            </p>
            <h1
              className="font-display font-light mt-auto"
              style={{ fontSize: 60, lineHeight: 1, letterSpacing: "0.02em" }}
            >
              SMART<span className="text-[var(--gold-dim)]">APPLY</span>
            </h1>
            <p className="text-primary" style={{ fontSize: 14, marginTop: 12, letterSpacing: "0.05em" }}>
              Skip the noise. Find your fit.
            </p>
            <p
              className="text-muted-foreground"
              style={{ fontSize: 14, lineHeight: 1.75, maxWidth: 360, marginTop: 22 }}
            >
              We read your resume once, then measure every open role against it. You see the
              fit, the gap, and the pay before you spend an evening applying.
            </p>
            <div className="flex items-center" style={{ gap: 12, marginTop: 26 }}>
              <Link
                href="/login"
                className="bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
                style={{ padding: "11px 22px", fontSize: 13.5, borderRadius: 2, letterSpacing: "0.01em" }}
              >
                Upload resume
              </Link>
              <Link
                href="/browse"
                className="border border-border font-medium hover:bg-muted transition-colors"
                style={{ padding: "11px 22px", fontSize: 13.5, borderRadius: 2 }}
              >
                Browse roles
              </Link>
            </div>
          </div>

          {/* figure panel - fixed-pixel geometry copied from the artboard's .fig */}
          <div
            className="relative hidden md:block overflow-hidden"
            style={{
              background:
                "linear-gradient(205deg, oklch(0.21 0.008 55), oklch(0.09 0.004 55) 72%)",
            }}
          >
            <div className="absolute inset-0">
              {/* head */}
              <div
                className="absolute"
                style={{
                  top: 72,
                  left: "50%",
                  transform: "translateX(-42%)",
                  width: 158,
                  height: 200,
                  borderRadius: "56% 56% 44% 44% / 62% 62% 38% 38%",
                  background: "linear-gradient(150deg, oklch(0.44 0.008 60), oklch(0.13 0.004 60) 72%)",
                  boxShadow:
                    "inset 0 2px 0 oklch(1 0 0 / 0.16), 0 30px 60px -20px oklch(0 0 0 / 0.85)",
                }}
              />
              {/* larger lens */}
              <div
                className="absolute rounded-full"
                style={{
                  top: 144,
                  left: "50%",
                  transform: "translateX(-98%)",
                  width: 54,
                  height: 54,
                  background:
                    "radial-gradient(circle at 34% 30%, oklch(0.8 0.05 62 / 0.9), oklch(0.16 0.006 60) 64%)",
                  boxShadow: "0 0 0 4px oklch(0.3 0.012 60), inset 0 0 12px oklch(0 0 0 / 0.7)",
                }}
              />
              {/* smaller lens */}
              <div
                className="absolute rounded-full"
                style={{
                  top: 156,
                  left: "50%",
                  transform: "translateX(8%)",
                  width: 38,
                  height: 38,
                  background:
                    "radial-gradient(circle at 34% 30%, oklch(0.68 0.04 62 / 0.85), oklch(0.14 0.006 60) 64%)",
                  boxShadow: "0 0 0 3px oklch(0.27 0.01 60), inset 0 0 10px oklch(0 0 0 / 0.7)",
                }}
              />
              {/* gold pipe detail */}
              <div
                className="absolute"
                style={{
                  top: 212,
                  left: "50%",
                  transform: "translateX(30%)",
                  width: 64,
                  height: 3,
                  background: "var(--gold-dim)",
                  opacity: 0.55,
                }}
              />
              {/* body silhouette */}
              <div
                className="absolute"
                style={{
                  top: 250,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 300,
                  height: 200,
                  borderRadius: "46% 46% 0 0",
                  background: "linear-gradient(180deg, oklch(0.17 0.005 60), oklch(0.08 0.003 60))",
                }}
              />
            </div>
          </div>
        </div>

        {/* approach + logo wall row */}
        <div className="grid md:grid-cols-[0.82fr_1.18fr] gap-5 items-stretch">
          <div
            className="panel-flat relative overflow-hidden"
            style={{
              maskImage: "linear-gradient(to bottom, transparent, black 16%, black 84%, transparent)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent, black 16%, black 84%, transparent)",
            }}
          >
            <span className="absolute top-5 left-6 z-10 text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground">
              Hiring now
            </span>
            {/* square spacer: sets the panel's own height so exactly 3 rows of
                3 square cells are visible, and the approach panel stretches
                to match rather than the other way around */}
            <div className="w-full aspect-square" aria-hidden />
            <div className="animate-[drift_22s_linear_infinite] flex flex-col absolute top-0 left-0 right-0">
              {[0, 1, 2].map((rep) => (
                <div key={rep} className="grid grid-cols-3 shrink-0">
                  {HIRING_LOGOS.map((logo, i) => (
                    <div
                      key={`${rep}-${i}`}
                      title={logo.name}
                      className="aspect-square flex items-center justify-center border-r border-b border-border text-muted-foreground/50"
                      style={{ borderRightWidth: (i + 1) % 3 === 0 ? 0 : 1 }}
                    >
                      <LogoMark path={logo.path} className="w-[38px] h-[38px]" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="panel-flat flex flex-col" style={{ padding: 34 }}>
            {/* the copy block centers in the space above the stats, so the taller
                square-panel row reads as breathing room rather than a dead gap */}
            <div className="flex-1 flex flex-col justify-center">
              <h2 className="font-display font-light" style={{ fontSize: 36, lineHeight: 1.1 }}>
                The <span className="text-[var(--gold-dim)]">approach</span>
              </h2>
              <p
                className="text-muted-foreground"
                style={{ fontSize: 14, lineHeight: 1.8, marginTop: 16, maxWidth: 430 }}
              >
                Forty five thousand roles across seven job boards, deduplicated and ranked
                against one resume. Every score shows its reasoning, so you decide where your
                evening goes.
              </p>
            </div>
            <div className="grid grid-cols-3" style={{ paddingTop: 26 }}>
              {[
                { value: "45,231", label: "Live roles measured" },
                { value: "3,940", label: "Companies hiring" },
                { value: "7", label: "Boards searched" },
              ].map((s, i) => (
                <div
                  key={s.label}
                  className={i > 0 ? "border-l border-border" : ""}
                  style={{ padding: i > 0 ? "0 26px" : "0 26px 0 0" }}
                >
                  <p className="font-display font-light" style={{ fontSize: 46 }}>{s.value}</p>
                  <p className="text-muted-foreground" style={{ fontSize: 12.5, marginTop: 8 }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* what happens before you apply */}
        <div className="panel-flat p-8" style={{ padding: 34 }}>
          <h2 className="font-display font-light text-4xl mb-1">
            What happens <span className="text-[var(--gold-dim)]">before you apply</span>
          </h2>
          {FEATURES.map((f) => (
            <div key={f.num} className="grid grid-cols-[34px_1fr] gap-4 border-t border-border" style={{ padding: "18px 0" }}>
              <span className="font-display text-xl text-[var(--gold-dim)] leading-none">{f.num}</span>
              <div>
                <p className="font-semibold text-[15px]">{f.title}</p>
                <p className="text-muted-foreground" style={{ fontSize: 13, marginTop: 5, lineHeight: 1.6 }}>{f.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-border text-xs text-muted-foreground" style={{ paddingTop: 22 }}>
          <span className="font-display text-base text-foreground" style={{ letterSpacing: "0.04em" }}>
            Smart<span className="font-medium text-primary">Apply</span>
          </span>
          <span>Free to use &middot; Bring your own AI key</span>
        </div>
      </div>
    </div>
  );
}
