export default function NewsLoadingPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 animate-pulse rounded-2xl border border-slate-200 bg-white p-6">
        <div className="h-5 w-40 rounded bg-slate-200" />
        <div className="mt-3 h-4 w-72 rounded bg-slate-100" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="animate-pulse rounded-2xl border border-slate-200 bg-white p-6"
          >
            <div className="h-4 w-36 rounded bg-slate-200" />
            <div className="mt-4 h-5 w-11/12 rounded bg-slate-200" />
            <div className="mt-2 h-4 w-full rounded bg-slate-100" />
            <div className="mt-2 h-4 w-10/12 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </main>
  );
}
