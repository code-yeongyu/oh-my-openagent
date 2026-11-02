export async function waitForSecret() {
  await document.fonts.ready
  const element = document.querySelector<HTMLElement>(".lit-progress")!
  await new Promise<void>((resolve, reject) => {
    const ready = () =>
      element.dataset.litMode
        ? element.dataset.litMode !== "pending"
        : element.classList.contains("lit-scroll") ||
          element.style.getPropertyValue("--lit-p") !== ""
    if (ready()) return resolve()
    const observer = new MutationObserver(() => {
      if (!ready()) return
      clearTimeout(timeout)
      observer.disconnect()
      resolve()
    })
    const timeout = setTimeout(() => {
      observer.disconnect()
      reject(new Error("Secret did not hydrate"))
    }, 5000)
    observer.observe(element, { attributes: true })
  })
}

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

export function readSecret() {
  const element = document.querySelector<HTMLElement>(".lit-progress")!
  const body = element.querySelector<HTMLElement>(".lit-text")!
  const follow = element.querySelector<HTMLElement>(".lit-follow")!
  const style = getComputedStyle(follow)
  const rect = follow.getBoundingClientRect()
  const translation = style.transform === "none" ? 0 : new DOMMatrixReadOnly(style.transform).m42
  return {
    scrollY,
    viewport: { width: innerWidth, height: innerHeight },
    mode: element.classList.contains("lit-scroll") ? "timeline" : "fallback",
    progress: getComputedStyle(element).getPropertyValue("--lit-p"),
    rangeStart: getComputedStyle(element).animationRangeStart,
    rangeEnd: getComputedStyle(element).animationRangeEnd,
    body: body.getBoundingClientRect().toJSON(),
    follow: { ...rect.toJSON(), flowTop: rect.top - translation, transform: style.transform },
    opacity: Number(style.opacity),
    headerBottom: document.querySelector("header")!.getBoundingClientRect().bottom,
    words: Array.from(body.querySelectorAll(".lit-word"), (word) => {
      const css = getComputedStyle(word)
      return {
        text: word.textContent,
        fill: 100 - Number.parseFloat(css.backgroundPositionX),
        gradient: css.backgroundImage,
        blur: css.filter,
      }
    }),
  }
}
