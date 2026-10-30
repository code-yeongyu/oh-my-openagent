const styles = css`
  .alert { border-left: 4px solid #dc2626; border-radius: 0 6px 6px 0; }
`

export const Quotes = () => (
  <>
    <blockquote className="rounded-r-lg border-l-4 border-blue-500 pl-4">Square on the stripe side</blockquote>
    <aside className="rounded-xl rounded-l-none border-l-4 border-sky-500">Left corners squared</aside>
    <style>{`.note { border-left: 4px solid #16a34a; border-top-right-radius: 8px; border-bottom-right-radius: 8px; }`}</style>
    <div className="border-l-4 border-blue-500 pl-4">Flat quote, no corners</div>
    <div className="rounded-none border-l-4 border-blue-500">Square</div>
  </>
)
