export default function Loading() {
  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="h-8 w-24 rounded-lg bg-forest-green/8 animate-pulse mb-8" />
        <div className="space-y-4">
          {[1,2,3].map(i => (
            <div key={i} className="h-32 rounded-xl bg-forest-green/5 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
