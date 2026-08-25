"use client";

import { usePathname } from "next/navigation";
import { Header } from "@/components/Header";
import { AuthGate } from "@/components/AuthGate";

const BARE_ROUTES = ["/login", "/"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_ROUTES.includes(pathname);

  if (bare) {
    return <>{children}</>;
  }

  return (
    <AuthGate>
      <Header />
      <main className="w-full px-6 py-6">{children}</main>
      <footer className="w-full px-6 py-6 text-xs text-muted-foreground">
        Smart Apply. Hybrid score = 0.50 skill overlap + 0.35 semantic similarity +
        0.15 experience alignment.
      </footer>
    </AuthGate>
  );
}
