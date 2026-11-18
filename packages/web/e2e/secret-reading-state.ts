export async function scrollSecret(y: number) {
  const target = Math.round(
    Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight)),
  )
  await new Promise<void>((resolve, reject) => {
    const painted = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    if (Math.abs(scrollY - target) < 1) {
      painted()
      return
    }
    const onEnd = () => {
      clearTimeout(timeout)
      document.removeEventListener("scrollend", onEnd)
      painted()
    }
    const timeout = setTimeout(() => {
      document.removeEventListener("scrollend", onEnd)
      reject(new Error(`Scroll to ${target} did not finish`))
    }, 5000)
    document.addEventListener("scrollend", onEnd)
    scrollTo({ top: target, behavior: "instant" })
  })
}
