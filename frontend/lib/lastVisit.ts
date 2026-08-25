// Tracks when the user last viewed their matches, purely client-side (no
// login required), so the digest panel can ask "what's new since then" -
// consumeLastMatchesVisit() returns the PREVIOUS timestamp and immediately
// overwrites it with now, so a caller gets one honest "since" value per
// visit rather than the digest silently re-including jobs already shown.
const STORAGE_KEY = "job_dekho_last_matches_visit";

export function consumeLastMatchesVisit(): string | null {
  if (typeof window === "undefined") return null;
  const previous = localStorage.getItem(STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  return previous;
}
