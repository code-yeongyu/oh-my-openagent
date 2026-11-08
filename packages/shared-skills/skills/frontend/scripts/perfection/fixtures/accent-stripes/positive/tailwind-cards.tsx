export function Cards({ featured }: { featured: boolean }) {
  return (
    <section>
      <div className="rounded-xl border-l-4 border-indigo-500 bg-white p-6">Fast</div>
      <article className={cn("rounded-2xl p-4", featured && "border-t-4 border-t-primary")}>Plans</article>
    </section>
  )
}
