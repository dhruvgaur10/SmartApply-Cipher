import type { ApplicationStatus, ApplicationStatusValue } from "./types";

const STORAGE_KEY = "job_applications";

export function getApplications(): Record<string, ApplicationStatus> {
  if (typeof window === "undefined") return {};
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : {};
}

export function trackApplication(jobId: string, status: ApplicationStatusValue) {
  const applications = getApplications();
  applications[jobId] = {
    jobId,
    appliedAt: new Date().toISOString(),
    status,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
}

export function getApplicationStatus(jobId: string): ApplicationStatus | null {
  const applications = getApplications();
  return applications[jobId] || null;
}

export function updateApplicationStatus(jobId: string, status: ApplicationStatusValue, notes?: string) {
  const applications = getApplications();
  if (applications[jobId]) {
    applications[jobId].status = status;
    if (notes) applications[jobId].notes = notes;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
  }
}

export function removeApplication(jobId: string) {
  const applications = getApplications();
  delete applications[jobId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
}
