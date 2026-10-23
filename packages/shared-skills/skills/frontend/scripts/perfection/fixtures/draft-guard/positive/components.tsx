const cn = (...names: string[]) => names.join(" ")
export function Page() {
  return (
    <main>
      <Badge>New</Badge>
      <span className={cn("badge", "badge--hot")}>Hot</span>
      <span className="badge">✨ New</span>
      <p>Launch &#x1F680; today</p>
      <button type="button" aria-label="🚀 Launch">Go</button>
      <Stat value="10x" />
      <StatCard><p>10x</p></StatCard>
      <div className="metric">{"500+"}</div>
      <input placeholder="Supercharge your search" />
    </main>
  )
}
