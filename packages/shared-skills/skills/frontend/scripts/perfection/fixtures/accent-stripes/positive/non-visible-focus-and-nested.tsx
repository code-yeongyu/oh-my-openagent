const css = css`
  .card:focus-within { border-radius: 12px; border-left: 3px solid #6366f1; }
  td .promo-card { border-radius: 8px; border-left: 4px solid #f43f5e; }
`

export const Focused = () => <div className="rounded-xl focus:border-l-4 focus:border-indigo-500">Card</div>
