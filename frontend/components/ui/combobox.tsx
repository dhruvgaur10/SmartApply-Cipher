"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, CheckIcon, XIcon } from "lucide-react";

export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  allLabel = "All",
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  allLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const displayLabel = value === "all" || !value ? allLabel : value;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent h-8 px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className={cn("truncate", value === "all" || !value ? "text-muted-foreground" : "")}>
          {displayLabel}
        </span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 overflow-hidden">
          <div className="p-1.5 border-b border-border">
            <div className="relative">
              <Input
                autoFocus
                placeholder={placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 pr-7"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => {
                onValueChange("all");
                setOpen(false);
                setQuery("");
              }}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground",
                (value === "all" || !value) && "font-medium"
              )}
            >
              {(value === "all" || !value) && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
              <span className={value === "all" || !value ? "" : "pl-5"}>{allLabel}</span>
            </button>
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground text-center">No matches</p>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    onValueChange(opt);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground",
                    value === opt && "font-medium"
                  )}
                >
                  {value === opt && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
                  <span className={value === opt ? "" : "pl-5"}>{opt}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
