// Static, templated (NOT AI-generated) negotiation guidance - zero Gemini
// cost. Fixed per experience tier, string-interpolated with real numbers
// from /api/stats/salary so the advice is grounded in this role's actual
// market band, not generic career advice.

export interface NegotiationScript {
  // A single scannable line, always shown - the number the user actually
  // needs, without the surrounding coaching paragraph.
  headline: string;
  // The full scripted phrasing, shown only behind a "get the exact
  // phrasing" disclosure for anyone who wants word-for-word help.
  script: string;
}

const TEMPLATES: Record<string, (median: number, min: number, max: number) => NegotiationScript> = {
  Fresher: (median) => ({
    headline: `Target: around ${median} LPA, the market median for fresher roles like this.`,
    script: `I'm looking for a package aligned with the market rate for this role, roughly ${median} LPA, and I'm flexible depending on the full offer including learning opportunities and growth path.`,
  }),
  Mid: (median, min, max) => ({
    headline: `Target: ${median}-${max} LPA, median ${median} for this level.`,
    script: `Given my experience and the scope of this role, I'm targeting somewhere around ${median}-${max} LPA, though I'm open to discussing the complete package.`,
  }),
  Senior: (median, min, max) => ({
    headline: `Target: ${median}-${max} LPA, median ${median} for senior roles like this.`,
    script: `Considering my experience level and the market for this role, I'd expect a package in the ${median}-${max} LPA range, and I'm happy to discuss based on the full scope of responsibilities.`,
  }),
};

export function getNegotiationScript(
  experienceLevel: string | null,
  band: { median_lpa: number | null; min_lpa: number; max_lpa: number } | undefined
): NegotiationScript | null {
  if (!band || band.median_lpa == null) return null;
  const template = TEMPLATES[experienceLevel ?? ""] ?? TEMPLATES.Mid;
  return template(band.median_lpa, band.min_lpa, band.max_lpa);
}
