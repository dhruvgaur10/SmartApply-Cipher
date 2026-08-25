const STORAGE_KEY = "gemini_api_key";
const CHANGE_EVENT = "job_dekho_api_key_change";

export function getApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function setApiKey(key: string) {
  sessionStorage.setItem(STORAGE_KEY, key);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearApiKey() {
  sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onApiKeyChange(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}
