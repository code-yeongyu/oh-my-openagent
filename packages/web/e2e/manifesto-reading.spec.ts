import { expect, test } from "@playwright/test"

import { scrollSecret } from "./secret-reading-state"

interface LineState {
  readonly index: number
  readonly top: number
  readonly progress: number
}

async function waitForReadingBlocks(): Promise<void> {
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

function readLines(): { mode: string; lines: LineState[] } {
  const first = document.querySelector<HTMLElement>(".lit-read")
  const lines = Array.from(document.querySelectorAll<HTMLElement>(".lit-read .lit-line"))
  return {
    mode: first?.dataset.litMode ?? "missing",
    lines: lines.map((line, index) => ({
      index,
      top: line.getBoundingClientRect().top,
      progress: Number.parseFloat(getComputedStyle(line).getPropertyValue("--lit-p")),
    })),
  }
}

const midSweep = (lines: readonly LineState[]): LineState[] =>
  lines.filter((line) => line.progress > 0 && line.progress < 1)

for (const locale of ["en", "ko"]) {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 900 },
  ]) {
    test.describe(`${locale} ${viewport.width}`, () => {
      test.use({ viewport })

      for (const variant of ["timeline", "fallback"]) {
        test(`one line sweeps at a time, reversibly (${variant})`, async ({ page }) => {
          await page.emulateMedia({ reducedMotion: "no-preference" })
          if (variant === "fallback") {
            await page.addInitScript(() => {
              const supports = CSS.supports.bind(CSS)
              CSS.supports = ((...args: [string] | [string, string]) =>
                args.some((arg) => arg.includes("animation-timeline"))
                  ? false
                  : args.length === 1
                    ? supports(args[0])
                    : supports(args[0], args[1])) as typeof CSS.supports
            })
          }
          await page.goto(`/${locale}/manifesto`)
          await page.evaluate(waitForReadingBlocks)
          const initial = await page.evaluate(readLines)
          expect(initial.mode).toBe(variant === "timeline" ? "scroll" : "observer")
          expect(initial.lines.length).toBeGreaterThan(30)

          const maxY = await page.evaluate(
            () => document.documentElement.scrollHeight - innerHeight,
          )
          const readingLine = viewport.height / 2
          let sawSweep = false
          for (let y = 200; y < maxY; y += 89) {
            await page.evaluate(scrollSecret, y)
            const { lines } = await page.evaluate(readLines)
            const active = midSweep(lines)
            // At most the line on the reading line plus the first words of its neighbour.
            expect(active.length, `scrollY ${y}`).toBeLessThanOrEqual(2)
            const [first, second] = active
            if (first && second) expect(second.index - first.index).toBe(1)
            for (const line of active) {
              sawSweep = true
              expect(Math.abs(line.top + 20 - readingLine), `scrollY ${y}`).toBeLessThan(
                viewport.height * 0.12,
              )
            }
            // Everything well above the reading line is lit, everything well below is not.
            for (const line of lines) {
              if (line.top < readingLine - 120) expect(line.progress, `scrollY ${y}`).toBe(1)
              if (line.top > readingLine + 120) expect(line.progress, `scrollY ${y}`).toBe(0)
            }
          }
          expect(sawSweep).toBe(true)

          await page.evaluate(scrollSecret, maxY)
          const bottom = await page.evaluate(readLines)
          expect(bottom.lines.every((line) => line.progress === 1)).toBe(true)

          await page.evaluate(scrollSecret, 0)
          const top = await page.evaluate(readLines)
          expect(top.lines.filter((line) => line.progress === 0).length).toBeGreaterThan(
            top.lines.length / 2,
          )
        })
      }

      test("reduced motion is fully readable", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" })
        await page.goto(`/${locale}/manifesto`)
        await page.evaluate(waitForReadingBlocks)
        const state = await page.evaluate(readLines)
        expect(state.mode).toBe("observer")
        const colors = await page.evaluate(() =>
          Array.from(
            new Set(
              Array.from(document.querySelectorAll(".lit-read .lit-word"), (word) => {
                const css = getComputedStyle(word)
                return `${css.color}|${css.backgroundImage}|${css.filter}`
              }),
            ),
          ),
        )
        expect(colors).toHaveLength(1)
        expect(colors[0]).toContain("none|none")
      })
    })
  }
}
