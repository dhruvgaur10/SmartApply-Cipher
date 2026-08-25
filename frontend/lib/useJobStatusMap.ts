"use client";

import { useEffect, useState } from "react";
import { getApplications } from "./applicationTracker";
import { getSavedJobIds, onSavedJobsChange } from "./savedJobs";
import type { ApplicationStatus } from "./types";

/**
 * Reads the applied/saved localStorage stores exactly once for the whole
 * list, instead of once per JobCard. With N cards mounted, the previous
 * per-card useEffect meant 2N synchronous localStorage reads + JSON parses;
 * this collapses that to 2 reads total, and re-reads the saved set only when
 * a save is actually toggled (via the existing onSavedJobsChange pub/sub).
 */
export function useJobStatusMap() {
  const [applications, setApplications] = useState<Record<string, ApplicationStatus>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setApplications(getApplications());
    setSavedIds(new Set(getSavedJobIds()));
    return onSavedJobsChange(() => setSavedIds(new Set(getSavedJobIds())));
  }, []);

  return { applications, savedIds };
}
