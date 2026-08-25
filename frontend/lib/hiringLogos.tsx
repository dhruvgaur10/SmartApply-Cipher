import logoData from "./logoData.json";

// Real brand marks (simple-icons, MIT licensed) for companies confirmed
// present in the live job corpus at the time this was written (verified via
// GET /api/jobs/search?q=<name> before adding each entry) - shown as
// factual "hiring now" indication, not an implied partnership. Rendered
// with currentColor so they inherit the muted foreground tone rather than
// each brand's own color, which keeps the wall reading as texture.
export const HIRING_LOGOS: { name: string; path: string }[] = logoData;

export function LogoMark({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d={path} />
    </svg>
  );
}
