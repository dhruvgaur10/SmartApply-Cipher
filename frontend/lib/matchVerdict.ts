import type { MatchBreakdown } from "./types";

// Client-side mirror of the backend's generate_match_verdict template
// (backend/app/services/matching.py). The backend is the source of truth and
// its verdict is always preferred; this only fills in when a match arrives
// without one - most often a resume result cached in sessionStorage from
// before the verdict field existed, which would otherwise render a blank
// line with no explanation. Kept deterministic and template-based for the
// same reason the backend is: a template cannot hallucinate a fit claim.
export function fallbackVerdict(breakdown: MatchBreakdown): string {
  const matched = breakdown.matched_skills ?? [];
  const missing = breakdown.missing_skills ?? [];
  const confidence = breakdown.confidence ?? "high";
  const totalSkills = matched.length + missing.length;
  const expAlignment = breakdown.experience_alignment ?? 0;
  const hasExpSignal = breakdown.has_experience_signal !== false;

  if (totalSkills === 0) {
    return confidence === "low"
      ? "Fit unclear. This posting lists no skills, so the score leans on text similarity alone."
      : "Fit unclear. This posting lists no skills to compare against yours.";
  }

  let base: string;
  if (missing.length === 0) {
    base = `Strong fit. You have all ${totalSkills} listed skills`;
  } else if (missing.length === 1) {
    base = `Close fit. You have ${matched.length} of ${totalSkills} skills, missing only ${missing[0]}`;
  } else if (missing.length === 2) {
    base = `Good fit. You have ${matched.length} of ${totalSkills} skills, missing ${missing[0]} and ${missing[1]}`;
  } else if (matched.length >= missing.length) {
    base = `Good fit. You have ${matched.length} of ${totalSkills} skills`;
  } else if (matched.length > 0) {
    base = `Partial fit. Only ${matched.length} of ${totalSkills} skills line up`;
  } else {
    base = `Weak fit. None of the ${totalSkills} listed skills match yours`;
  }

  let tail: string;
  if (!hasExpSignal) {
    tail = ", and the posting does not state an experience requirement";
  } else if (expAlignment >= 0.85) {
    tail = ", and the seniority matches your level";
  } else if (expAlignment >= 0.5) {
    tail = ", though the seniority is a slight stretch";
  } else if (expAlignment >= 0.2) {
    tail = ", but it asks for more experience than you have";
  } else {
    tail = ", but it is aimed well above your current experience";
  }

  const suffix =
    confidence === "low" ? " Details here were auto-extracted and may be incomplete." : "";

  return `${base}${tail}.${suffix}`;
}
