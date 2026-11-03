export const Ok = () => (
  <div>
    <div className="rounded-lg border border-zinc-200 p-4">Plain</div>
    <div className="rounded-xl border-l-4 border-l-zinc-300 p-4">Neutral edge</div>
    <button className="rounded-md focus-visible:ring-2 focus-visible:ring-blue-500">Go</button>
    <input className="rounded-md border-b-2 aria-invalid:border-b-red-500 invalid:border-red-500" />
    <blockquote className="border-l-2 border-zinc-300 pl-4">Neutral quote rule</blockquote>
    <button className="rounded-md border border-indigo-500 px-3">Outline button</button>
    <div className="rounded-lg bg-blue-50 p-4 text-blue-900">Tonal surface</div>
    <input className="border-b-2 border-indigo-500" />
    <select className="rounded-md border-2 border-indigo-500" />
    <table><tbody><tr><td className="border-l-4 border-indigo-500">Sorted</td></tr></tbody></table>
  </div>
)
