export function JobCardSkeleton() {
  return (
    <div className="card-flat p-4 space-y-3 animate-pulse">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-muted rounded w-3/5" />
          <div className="h-3 bg-muted rounded w-2/5" />
        </div>
        <div className="h-5 bg-muted rounded w-14" />
      </div>
      <div className="flex gap-3">
        <div className="h-3 bg-muted rounded w-16" />
        <div className="h-3 bg-muted rounded w-20" />
      </div>
      <div className="space-y-1.5">
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-4/5" />
      </div>
      <div className="flex gap-1.5 pt-1">
        <div className="h-5 bg-muted rounded-full w-14" />
        <div className="h-5 bg-muted rounded-full w-16" />
        <div className="h-5 bg-muted rounded-full w-12" />
      </div>
    </div>
  );
}
