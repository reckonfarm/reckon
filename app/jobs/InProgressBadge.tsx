// IN PROGRESS — shown while a job's ended_at is still advancing (lib/jobs/
// display.ts isInProgress). Rendered server-side; freshness comes from
// force-dynamic + AutoRefresh, same as every number around it.
// animate-pulse is disabled in this project's @theme — scoped keyframe,
// same pattern as NewsHookCard / MarketsNews skeletons.
export default function InProgressBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-up/10 px-2.5 py-1">
      <style>{`@keyframes dlJobLive{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      <span
        className="h-1.5 w-1.5 rounded-full bg-up"
        style={{ animation: 'dlJobLive 1.6s ease-in-out infinite' }}
      />
      <span className="font-dm-sans text-[11px] font-semibold uppercase tracking-wide text-up">
        In progress
      </span>
    </span>
  )
}
