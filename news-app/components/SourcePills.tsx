interface SourcePillsProps {
  sources: string[];
  activeSource: string;
  counts: Record<string, number>;
  onChange: (source: string) => void;
}

/**
 * Horizontal source filter bar (pill tabs) matching the requested UX pattern.
 */
export function SourcePills({
  sources,
  activeSource,
  counts,
  onChange,
}: SourcePillsProps) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <div className="flex min-w-max items-center gap-2">
        {sources.map((source) => {
          const selected = source === activeSource;
          const count = counts[source] ?? 0;

          return (
            <button
              key={source}
              type="button"
              onClick={() => onChange(source)}
              className={[
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                selected
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100",
              ].join(" ")}
              aria-pressed={selected}
            >
              <span>{source}</span>
              <span
                className={[
                  "rounded-full px-1.5 py-0.5 text-[11px] leading-none",
                  selected ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600",
                ].join(" ")}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
