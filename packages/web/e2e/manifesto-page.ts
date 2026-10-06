// In-page helpers shared by the manifesto e2e specs; each runs inside page.evaluate.

export async function waitForReadingBlocks(): Promise<void> {
  await document.fonts.ready
  const blocks = Array.from(document.querySelectorAll<HTMLElement>(".lit-read"))
  await Promise.all(
    blocks.map(
      (block) =>
        new Promise<void>((resolve, reject) => {
          if (block.dataset.litMode !== "pending") return resolve()
          const observer = new MutationObserver(() => {
            if (block.dataset.litMode === "pending") return
            clearTimeout(timeout)
            observer.disconnect()
            resolve()
          })
          const timeout = setTimeout(() => {
            observer.disconnect()
            reject(new Error("Manifesto did not hydrate"))
          }, 5000)
          observer.observe(block, { attributes: true })
        }),
    ),
  )
}

export function firstProgress(): string {
  const first = document.querySelector<HTMLElement>(".lit-read")
  return first?.dataset.litMode ?? "missing"
}
