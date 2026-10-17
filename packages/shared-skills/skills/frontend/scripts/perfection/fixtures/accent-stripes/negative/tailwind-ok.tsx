export const Ok = () => (
  <div>
    <div className="rounded-lg border border-zinc-200 p-4">Plain</div>
    <div className="rounded-xl border-l-4 border-l-zinc-300 p-4">Neutral edge</div>
    <button className="rounded-md focus-visible:ring-2 focus-visible:ring-blue-500">Go</button>
    <input className="rounded-md border-b-2 aria-invalid:border-b-red-500 invalid:border-red-500" />
    <div className="border-l-4 border-blue-500 pl-4">Flat quote, no corners</div>
    <div className="rounded-none border-l-4 border-blue-500">Square</div>
    <div className="rounded-lg bg-blue-50 p-4 text-blue-900">Tonal surface</div>
  </div>
)
