// Pure regex/keyword parser - no Gemini call. Maps a free-text query like
// "3 year experience jobs in chandigarh" or "python and sql jobs" onto the
// existing structured search_jobs() filters (query/platform/category/
// min_years/max_years/location), so the parse is always visible and
// editable via the same dropdowns that back it - never a hidden black box.

const PLATFORMS = ["LinkedIn", "Naukri", "Indeed", "Internshala"];

const YEARS_RANGE_RE = /(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*\+?\s*years?/i;
const YEARS_MIN_PLUS_RE = /(\d{1,2})\s*\+\s*years?/i;
const YEARS_BARE_RE = /(\d{1,2})\s*years?(?:\s+of)?(?:\s+experience)?/i;
const LOCATION_RE = /\b(?:in|at|near|of)\s+([a-zA-Z][a-zA-Z\s]{1,30}?)(?:\s+(?:with|jobs?|role|position|having)\b|[,.]|$)/i;

export interface ParsedSearch {
  minYears?: number;
  maxYears?: number;
  platform?: string;
  location?: string;
  category?: string;
  remainingQuery: string;
}

export function parseHeuristicQuery(
  raw: string,
  options: { categories: string[]; sources: string[] }
): ParsedSearch {
  let text = raw.trim();
  const result: ParsedSearch = { remainingQuery: "" };

  const rangeMatch = text.match(YEARS_RANGE_RE);
  if (rangeMatch) {
    result.minYears = parseInt(rangeMatch[1], 10);
    result.maxYears = parseInt(rangeMatch[2], 10);
    text = text.replace(rangeMatch[0], " ");
  } else {
    const plusMatch = text.match(YEARS_MIN_PLUS_RE);
    if (plusMatch) {
      result.minYears = parseInt(plusMatch[1], 10);
      text = text.replace(plusMatch[0], " ");
    } else {
      const bareMatch = text.match(YEARS_BARE_RE);
      if (bareMatch) {
        // A bare "N years experience" mention is an approximation, not an
        // exact requirement - widen to a +/-1 year window so real intent
        // ("around 3 years") isn't over-filtered to only exactly-3 listings.
        const years = parseInt(bareMatch[1], 10);
        result.minYears = Math.max(0, years - 1);
        result.maxYears = years + 1;
        text = text.replace(bareMatch[0], " ");
      }
    }
  }

  const availablePlatforms = options.sources.length > 0 ? options.sources : PLATFORMS;
  for (const platform of availablePlatforms) {
    const re = new RegExp(`\\b${platform}\\b`, "i");
    if (re.test(text)) {
      result.platform = platform;
      text = text.replace(re, " ");
      break;
    }
  }

  const locationMatch = text.match(LOCATION_RE);
  if (locationMatch) {
    result.location = locationMatch[1].trim();
    text = text.replace(locationMatch[0], " ");
  }

  for (const category of options.categories) {
    const re = new RegExp(`\\b${category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) {
      result.category = category;
      text = text.replace(re, " ");
      break;
    }
  }

  // Strip generic filler words left over after extraction so the remaining
  // free text is a clean skill/title query, not "jobs where and is needed".
  const FILLER_WORDS = new Set([
    "jobs", "job", "role", "roles", "position", "positions", "where", "with",
    "having", "needed", "required", "and", "the", "a", "an", "for", "of",
    "is", "are", "that", "which", "me", "show", "find", "get", "want",
  ]);
  result.remainingQuery = text
    .split(/\s+/)
    .filter((w) => w && !FILLER_WORDS.has(w.toLowerCase()))
    .join(" ")
    .trim();

  return result;
}

export function describeParsedSearch(parsed: ParsedSearch): string {
  const parts: string[] = [];
  if (parsed.remainingQuery) parts.push(parsed.remainingQuery);
  if (parsed.category) parts.push(parsed.category);
  if (parsed.location) parts.push(parsed.location);
  if (parsed.platform) parts.push(parsed.platform);
  if (parsed.minYears !== undefined || parsed.maxYears !== undefined) {
    if (parsed.minYears !== undefined && parsed.maxYears !== undefined) {
      parts.push(`${parsed.minYears}-${parsed.maxYears} years`);
    } else if (parsed.minYears !== undefined) {
      parts.push(`${parsed.minYears}+ years`);
    }
  }
  return parts.join(" · ");
}
