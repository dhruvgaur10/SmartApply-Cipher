"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { JobCard } from "@/components/JobCard";
import { JobCardSkeleton } from "@/components/JobCardSkeleton";
import { ResumeUploadDialog } from "@/components/ResumeUploadDialog";
import { ChatDrawer } from "@/components/ChatDrawer";
import { StatsHero } from "@/components/StatsHero";
import { searchJobs, getSources, getCategories, getSalaryStats, type ExperienceLevelBand } from "@/lib/api";
import { parseHeuristicQuery, describeParsedSearch } from "@/lib/heuristicSearch";
import { useJobStatusMap } from "@/lib/useJobStatusMap";
import type { Job } from "@/lib/types";
import { Loader2, Sparkles, MapPin } from "lucide-react";

// Mirrors the grid's own breakpoints (grid-cols-1 / sm:grid-cols-2 /
// lg:grid-cols-3) so virtualized rows group the right number of cards per
// row at each width. Tailwind's `sm` and `lg` breakpoints.
const COLUMN_BREAKPOINTS = [
  { minWidth: 1024, columns: 3 },
  { minWidth: 640, columns: 2 },
  { minWidth: 0, columns: 1 },
];

function useColumnCount() {
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    function update() {
      const width = window.innerWidth;
      const match = COLUMN_BREAKPOINTS.find((b) => width >= b.minWidth);
      setColumns(match?.columns ?? 1);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return columns;
}

const EXPERIENCE_BUCKETS = [
  { label: "0-2 years", minYears: 0, maxYears: 2 },
  { label: "3-5 years", minYears: 3, maxYears: 5 },
  { label: "6-9 years", minYears: 6, maxYears: 9 },
  { label: "10+ years", minYears: 10, maxYears: undefined },
];
const PAGE_SIZE = 20;

export default function BrowsePage() {
  return (
    <Suspense fallback={<BrowseFallback />}>
      <BrowsePageInner />
    </Suspense>
  );
}

function BrowseFallback() {
  return (
    <div className="flex justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

const GRID_COL_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

/**
 * Renders `jobs` as a window-scroll-virtualized grid, grouped into rows of
 * `columns` cards each. Only rows near the viewport are mounted, so the DOM
 * node count stays roughly flat as the list grows via infinite scroll,
 * instead of accumulating every job ever loaded. Uses the window virtualizer
 * (not an inner scroll container) so the page keeps its normal whole-page
 * scroll behavior, and the existing IntersectionObserver-driven loadMore
 * pagination above is untouched - this only changes what gets mounted.
 */
function VirtualizedJobGrid({
  jobs,
  columns,
  highlightQuery,
  salaryBands,
  applications,
  savedIds,
  loadingMore,
}: {
  jobs: Job[];
  columns: number;
  highlightQuery: string;
  salaryBands: Record<string, ExperienceLevelBand>;
  applications: Record<string, { status: string }>;
  savedIds: Set<string>;
  loadingMore: boolean;
}) {
  const trailingSkeletonRows = loadingMore ? Math.ceil(3 / columns) : 0;
  const rowCount = Math.ceil(jobs.length / columns) + trailingSkeletonRows;

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    // Real JobCard rows measure 300-420px depending on how many bullets,
    // skill badges and salary info a job has (confirmed by measuring
    // rendered rows directly) - 380 is close to the observed average.
    // The previous 260px estimate under-shot every real row by roughly
    // 40%, so every row entering the viewport triggered a large post-
    // measurement layout shift for itself AND every row below it, which
    // is what produced visible jank/lag while scrolling. A closer
    // estimate means far fewer, smaller corrections.
    estimateSize: () => 380,
    overscan: 6,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
      className="w-full"
    >
      {items.map((virtualRow) => {
        const startIndex = virtualRow.index * columns;
        const isSkeletonRow = startIndex >= jobs.length;
        const rowJobs = isSkeletonRow ? [] : jobs.slice(startIndex, startIndex + columns);

        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={(el) => {
              // react-virtual's measureElement runs its ResizeObserver
              // callback synchronously, which can collide with React 18's
              // concurrent rendering when another state update (e.g. the
              // infinite-scroll sentinel firing loadMore) is in flight at the
              // same time, producing a "flushSync was called from inside a
              // lifecycle method" warning. Deferring the measurement to the
              // next frame avoids the collision without losing dynamic
              // height measurement.
              if (!el) return;
              requestAnimationFrame(() => virtualizer.measureElement(el));
            }}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
            className="pb-4"
          >
            <div className={`grid gap-4 ${GRID_COL_CLASS[columns] ?? GRID_COL_CLASS[3]}`}>
              {isSkeletonRow
                ? Array.from({ length: columns }).map((_, i) => <JobCardSkeleton key={i} />)
                : rowJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      highlightQuery={highlightQuery}
                      salaryBands={salaryBands}
                      applied={!!applications[job.id]}
                      saved={savedIds.has(job.id)}
                    />
                  ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BrowsePageInner() {
  const searchParams = useSearchParams();
  const [smartInput, setSmartInput] = useState("");
  const [understood, setUnderstood] = useState("");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  // Debounced separately from the search-execution effect below, at the same
  // 300ms cadence, so JobCard's highlightQuery prop stays referentially
  // stable between keystrokes - passing the raw `query` state directly
  // defeated JobCard's memoization on every keystroke, re-rendering every
  // mounted card in the list just from typing in the search box.
  const [displayQuery, setDisplayQuery] = useState(query);
  const [platform, setPlatform] = useState(searchParams.get("platform") ?? "all");
  const [experienceBucket, setExperienceBucket] = useState("all");
  const [smartYears, setSmartYears] = useState<{ minYears?: number; maxYears?: number } | null>(null);
  const [category, setCategory] = useState(searchParams.get("category") ?? "all");
  const [location, setLocation] = useState("all");
  const [sources, setSources] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [salaryBands, setSalaryBands] = useState<Record<string, ExperienceLevelBand>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState<number | null>(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const { applications, savedIds } = useJobStatusMap();
  const columns = useColumnCount();

  useEffect(() => {
    getSources().then((r) => setSources(r.sources)).catch(() => {});
    getCategories().then((r) => setCategories(r.categories)).catch(() => {});
    getSalaryStats().then((r) => setSalaryBands(r.by_experience_level)).catch(() => {});
  }, []);

  useEffect(() => {
    const paramMinYears = searchParams.get("min_years");
    const paramMaxYears = searchParams.get("max_years");
    if (paramMinYears || paramMaxYears) {
      const match = EXPERIENCE_BUCKETS.find(
        (b) => String(b.minYears) === paramMinYears && String(b.maxYears ?? "") === (paramMaxYears ?? "")
      );
      if (match) setExperienceBucket(match.label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeBucket = EXPERIENCE_BUCKETS.find((b) => b.label === experienceBucket);
  // A smart-search-derived year range (e.g. "3 years" widened to [2,4]) takes
  // precedence over the bucket dropdown whenever set, since the heuristic
  // parser's range often doesn't align with any predefined bucket - falling
  // back to the bucket would silently drop the parsed year filter while the
  // "Understood:" strip still claims it was applied.
  const minYears = smartYears ? smartYears.minYears : activeBucket?.minYears;
  const maxYears = smartYears ? smartYears.maxYears : activeBucket?.maxYears;

  function handleSmartSearch(text: string) {
    setSmartInput(text);
    if (!text.trim()) {
      // Clearing the smart-search box clears everything it set, so no
      // stale filter silently stays applied once its explanation ("
      // Understood: ...") disappears.
      setUnderstood("");
      setSmartYears(null);
      setQuery("");
      setPlatform("all");
      setCategory("all");
      setLocation("all");
      setExperienceBucket("all");
      return;
    }
    const parsed = parseHeuristicQuery(text, { categories, sources });
    // Only the facets the smart search actually parsed are set - anything
    // not mentioned in this exact phrase leaves a manually-set dropdown
    // filter untouched, rather than resetting it to "all" every keystroke.
    setQuery(parsed.remainingQuery);
    if (parsed.platform) setPlatform(parsed.platform);
    if (parsed.category) setCategory(parsed.category);
    if (parsed.location) setLocation(parsed.location);
    if (parsed.minYears !== undefined || parsed.maxYears !== undefined) {
      const match = EXPERIENCE_BUCKETS.find(
        (b) => b.minYears === parsed.minYears && (b.maxYears ?? undefined) === parsed.maxYears
      );
      if (match) {
        setExperienceBucket(match.label);
        setSmartYears(null);
      } else {
        setExperienceBucket("all");
        setSmartYears({ minYears: parsed.minYears, maxYears: parsed.maxYears });
      }
    } else {
      setSmartYears(null);
    }
    setUnderstood(describeParsedSearch(parsed));
  }

  function handleBucketChange(bucket: string | null) {
    // Manual dropdown interaction always overrides a prior smart-search
    // year range, since the user is now explicitly stating their intent.
    setSmartYears(null);
    setExperienceBucket(bucket ?? "all");
  }

  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await searchJobs({
        q: query,
        platform,
        minYears,
        maxYears,
        category,
        location: location === "all" ? undefined : location,
        limit: PAGE_SIZE,
        offset: 0,
      });
      setJobs(result.jobs);
      setTotal(result.total);
      setHasMore(result.has_more);
    } finally {
      setLoading(false);
    }
  }, [query, platform, minYears, maxYears, category, location]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const result = await searchJobs({
        q: query,
        platform,
        minYears,
        maxYears,
        category,
        location: location === "all" ? undefined : location,
        limit: PAGE_SIZE,
        offset: jobs.length,
      });
      setJobs((prev) => [...prev, ...result.jobs]);
      setHasMore(result.has_more);
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [query, platform, minYears, maxYears, category, location, jobs.length, hasMore]);

  const isFirstRun = useRef(true);
  useEffect(() => {
    // Only debounce keystroke-driven text queries; dropdown filter changes
    // should feel instant, not wait out the same 300ms typing debounce.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      runSearch();
      return;
    }
    const timer = setTimeout(runSearch, query ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, platform, experienceBucket, category, location, smartYears]);

  useEffect(() => {
    const timer = setTimeout(() => setDisplayQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="space-y-6">
      <StatsHero />

      <div className="space-y-2">
        <div className="relative">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
          <Input
            placeholder='Search by title, skill, or try "3 years python jobs in bangalore"'
            value={smartInput}
            onChange={(e) => handleSmartSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {understood && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
            <span>Understood:</span>
            <Badge variant="accent" className="text-xs">
              {understood}
            </Badge>
            <span>&mdash; adjust with the filters below if needed</span>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Location"
            value={location === "all" ? "" : location}
            onChange={(e) => setLocation(e.target.value.trim() ? e.target.value : "all")}
            className="pl-9"
          />
        </div>
        <Select value={platform} onValueChange={(v) => setPlatform(v ?? "all")}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue>{(v: string) => (v === "all" ? "All platforms" : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={experienceBucket} onValueChange={handleBucketChange}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue>{(v: string) => (v === "all" ? "Any experience" : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any experience</SelectItem>
            {EXPERIENCE_BUCKETS.map((b) => (
              <SelectItem key={b.label} value={b.label}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Combobox
          value={category}
          onValueChange={setCategory}
          options={categories}
          placeholder="Search categories..."
          allLabel="All categories"
          className="w-full sm:w-[190px]"
        />
        <ResumeUploadDialog />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {loading
            ? "Searching..."
            : total !== null
              ? `${total} jobs found`
              : `${jobs.length}${hasMore ? "+" : ""} jobs found`}
        </p>
      </div>

      {loading ? (
        <div className={`grid gap-4 ${columns === 1 ? "" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
          {Array.from({ length: 6 }).map((_, i) => (
            <JobCardSkeleton key={i} />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <p className="text-center py-16 text-muted-foreground">
          No jobs match your filters. Try broadening your search.
        </p>
      ) : (
        <>
          <VirtualizedJobGrid
            jobs={jobs}
            columns={columns}
            highlightQuery={displayQuery}
            salaryBands={salaryBands}
            applications={applications}
            savedIds={savedIds}
            loadingMore={loadingMore}
          />
          {hasMore && <div ref={sentinelRef} className="h-1" />}
          {!hasMore && jobs.length > 0 && (
            <p className="text-center text-xs text-muted-foreground py-6">
              You&apos;ve reached the end &mdash; {jobs.length} jobs shown.
            </p>
          )}
        </>
      )}

      <ChatDrawer />
    </div>
  );
}
