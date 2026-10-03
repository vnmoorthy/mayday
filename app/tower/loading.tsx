// Skeleton for the tower index and each vendor tower while the server reads.
export default function TowerLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-14 px-5 py-12 sm:px-8 sm:py-20" aria-busy="true">
      <div className="flex flex-col gap-6">
        <span className="label">Contacting the tower</span>
        <div className="h-16 w-2/3 max-w-xl animate-pulse rounded-2xl bg-ink/10 sm:h-24" />
      </div>
      <div className="flex flex-col gap-3 rounded-2xl border border-ink/15 bg-panel p-5 sm:p-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="py-2">
            <div className="h-4 w-full animate-pulse rounded-full bg-ink/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
