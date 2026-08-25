const STORAGE_KEY = "job_dekho_saved";
const EVENT_NAME = "job_dekho_saved_change";

export function getSavedJobIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function isJobSaved(jobId: string): boolean {
  return getSavedJobIds().includes(jobId);
}

function persist(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function toggleSavedJob(jobId: string): boolean {
  const current = getSavedJobIds();
  if (current.includes(jobId)) {
    persist(current.filter((id) => id !== jobId));
    return false;
  }
  persist([...current, jobId]);
  return true;
}

export function removeSavedJob(jobId: string) {
  persist(getSavedJobIds().filter((id) => id !== jobId));
}

export function onSavedJobsChange(callback: () => void): () => void {
  window.addEventListener(EVENT_NAME, callback);
  return () => window.removeEventListener(EVENT_NAME, callback);
}
