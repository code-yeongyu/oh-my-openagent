export function Summary({ count, status, uptime }: { count: number; status: string; uptime: string }) {
  return (
    <section>
      <div className="stat"><span className="stat-value">{count}</span><span>open tickets</span></div>
      <div className="metric">{uptime}</div>
      <span className="badge" data-status={status}>{status}</span>
      <span className="badge">3</span>
      <span className="chip">Failed</span>
      <p>Seams in the fabric are reinforced.</p>
    </section>
  )
}
