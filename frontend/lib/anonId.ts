// A browser-local id, no login required, so per-browser feedback can be
// grouped without any auth work. Not tied to a Supabase account - purely a
// stable random id persisted in localStorage.
const STORAGE_KEY = "job_dekho_anon_id";

export function getAnonId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
