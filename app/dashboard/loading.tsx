export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <div className="sticky top-0 z-40 border-b border-forest-green/10 bg-cream/80 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="h-7 w-20 rounded-lg bg-forest-green/8 animate-pulse" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="space-y-4">
          <div className="h-10 w-64 rounded-xl bg-forest-green/8 animate-pulse" />
          <div className="h-48 rounded-xl bg-forest-green/5 animate-pulse" />
          <div className="h-64 rounded-xl bg-forest-green/5 animate-pulse" />
          <div className="h-96 rounded-xl bg-forest-green/5 animate-pulse" />
        </div>
      </div>
    </div>
  )
}
