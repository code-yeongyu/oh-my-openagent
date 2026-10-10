import { expect, test } from "@playwright/test"

import { expectUniformWordGlyphs } from "./manifesto-glyphs"
import { firstProgress, waitForReadingBlocks } from "./manifesto-page"
import { scrollSecret } from "./secret-reading-state"

for (const locale of ["en", "ko"]) {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 900 },
  ]) {
    test.describe(`${locale} ${viewport.width}`, () => {
      test.use({ viewport })

      test("reduced motion is fully readable", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" })
        await page.goto(`/${locale}/manifesto`)
        await page.evaluate(waitForReadingBlocks)
        expect(await page.evaluate(firstProgress)).toBe("observer")
        const lit = await page.evaluate(() => {
          const blocks = Array.from(document.querySelectorAll<HTMLElement>(".lit-read"))
          const words = Array.from(document.querySelectorAll<HTMLElement>(".lit-read .lit-word"))
          return {
            blocksLit: blocks.every(
              (block) =>
                Number.parseFloat(getComputedStyle(block).getPropertyValue("--lit-p")) === 1,
            ),
            allTextHi: words.every((word) => getComputedStyle(word).color === "rgb(245, 245, 247)"),
            noneBlurred: words.every((word) => {
              const filter = getComputedStyle(word).filter
              return filter === "none" || filter === "blur(0px)"
            }),
          }
        })
        expect(lit.blocksLit).toBe(true)
        expect(lit.allTextHi).toBe(true)
        expect(lit.noneBlurred).toBe(true)
        // Reduced motion shows every word fully lit: none is dimmed by the reveal (review N2).
        const fullyLit = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>(".lit-read .lit-word")).every(
            (word) => {
              const css = getComputedStyle(word)
              return (
                Number.parseFloat(css.opacity) === 1 &&
                Number.parseFloat(css.getPropertyValue("--lit-local")) >= 1
              )
            },
          ),
        )
        expect(fullyLit).toBe(true)
      })

      // Without JavaScript the page reads in full: reveal blocks render `pending` (lit) so text is
      // never stuck at the dim floor if the driver never runs.
      test("readable before and without JavaScript", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "no-preference" })
        const context = page.context()
        await context.route("**/*.{js,mjs}", (route) => route.abort())
        await page.goto(`/${locale}/manifesto`)
        const state = await page.evaluate(() => {
          const blocks = Array.from(document.querySelectorAll<HTMLElement>(".lit-read"))
          const words = Array.from(document.querySelectorAll<HTMLElement>(".lit-read .lit-word"))
          return {
            modes: Array.from(new Set(blocks.map((block) => block.dataset.litMode))),
            wordCount: words.length,
            // Match the per-word fade's color serialization with a fully lit reference.
            renderedWords: words.map((word) => {
              const reference = document.createElement("span")
              reference.style.color = "color-mix(in oklab, var(--text-hi), var(--text-hi))"
              word.append(reference)
              const fullBright = getComputedStyle(reference).color
              reference.remove()
              const css = getComputedStyle(word)
              return { color: css.color, fullBright, opacity: css.opacity }
            }),
          }
        })
        expect(state.modes).toContain("pending")
        expect(state.wordCount).toBeGreaterThan(0)
        for (const word of state.renderedWords) {
          expect(word.color).toBe(word.fullBright)
          expect(Number.parseFloat(word.opacity)).toBe(1)
        }
      })

      // Measure actual glyph brightness against lit/unlit references, tolerating AA fringes.
      // A split word has significant regions near both endpoints, unlike a uniform mid-fade.
      test("no word is ever split in half", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await page.goto(`/${locale}/manifesto`)
        await page.evaluate(waitForReadingBlocks)
        const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
        let checkedWords = 0
        for (const frac of [0.2, 0.4, 0.6, 0.8]) {
          await page.evaluate(scrollSecret, Math.round(maxY * frac))
          await page.evaluate(
            () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
          )
          checkedWords += await expectUniformWordGlyphs(page)
        }
        expect(checkedWords).toBeGreaterThan(0)
      })

      // Continuous brightness follows reading order, including the last word before a wrap.
      for (const mixedScript of [false, true]) {
        test(`the reveal respects reading order across wrapped lines${mixedScript ? " (mixed script)" : ""}`, async ({
          page,
        }) => {
          await page.emulateMedia({ reducedMotion: "no-preference" })
          await page.goto(`/${locale}/manifesto`)
          await page.evaluate(waitForReadingBlocks)
          if (mixedScript) {
            await page.evaluate(() => {
              const body = document.querySelector<HTMLElement>(".lit-read .lit-text")!
              const template = body.querySelector<HTMLElement>(".lit-word")!
              body.replaceChildren(
                ...Array.from({ length: 48 }, (_, index) => {
                  const word = template.cloneNode(false) as HTMLElement
                  word.textContent = index % 2 ? "한글" : "Latin"
                  // Reproduce fractional glyph bounds within the same visual line, independent of
                  // the host's installed font fallback metrics.
                  word.style.position = "relative"
                  word.style.top = `${index % 2 ? 0.25 : 0}px`
                  return [word, document.createTextNode(" ")]
                }).flat(),
              )
              window.dispatchEvent(new Event("resize"))
            })
          }
          const maxY = await page.evaluate(
            () => document.documentElement.scrollHeight - innerHeight,
          )
          let wrappedPairs = 0
          for (let y = 0; y <= maxY; y += 60) {
            await page.evaluate(scrollSecret, y)
            await page.evaluate(
              () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
            )
            const state = await page.evaluate(() => {
              let wraps = 0
              const violations: string[] = []
              for (const body of document.querySelectorAll(".lit-read .lit-text")) {
                const words = Array.from(body.querySelectorAll<HTMLElement>(".lit-word"))
                for (let i = 1; i < words.length; i += 1) {
                  const previous = words[i - 1]!
                  const current = words[i]!
                  if (
                    current.getBoundingClientRect().bottom >
                    previous.getBoundingClientRect().bottom + 1
                  )
                    wraps += 1
                  const brightness = (word: HTMLElement) =>
                    Number.parseFloat(getComputedStyle(word).getPropertyValue("--lit-local"))
                  if (brightness(current) > brightness(previous) + 0.001)
                    violations.push(`${previous.textContent} / ${current.textContent}`)
                }
              }
              return { wraps, violations }
            })
            wrappedPairs += state.wraps
            expect(state.violations, `scrollY ${y}`).toEqual([])
          }
          expect(wrappedPairs).toBeGreaterThan(0)
        })
      }

      // The reveal travels word by word: across a scroll sweep, some line shows a gradient of
      // --lit-local values across its words, never one shared value for the whole line.
      test("the reveal lights words one at a time", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await page.goto(`/${locale}/manifesto`)
        await page.evaluate(waitForReadingBlocks)
        const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
        let maxDistinct = 0
        for (const frac of [0.2, 0.35, 0.5, 0.65]) {
          await page.evaluate(scrollSecret, Math.round(maxY * frac))
          await page.evaluate(
            () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
          )
          const distinct = await page.evaluate(() => {
            const byLine = new Map<number, Set<string>>()
            for (const word of Array.from(
              document.querySelectorAll<HTMLElement>(".lit-read .lit-word"),
            )) {
              const key = Math.round(word.getBoundingClientRect().bottom)
              const local = Number.parseFloat(
                getComputedStyle(word).getPropertyValue("--lit-local"),
              ).toFixed(2)
              if (!byLine.has(key)) byLine.set(key, new Set())
              byLine.get(key)!.add(local)
            }
            return Math.max(0, ...Array.from(byLine.values()).map((set) => set.size))
          })
          maxDistinct = Math.max(maxDistinct, distinct)
        }
        // Some line in transition has more than one --lit-local value (word-by-word).
        expect(maxDistinct).toBeGreaterThan(1)
      })

      // TALL-block contract: while scrolling through the tallest reading block at normal speed, no
      // already-revealed word goes dim again (per-word geometry keeps revealed text lit). One
      // locale/width is enough — the contract is block-geometry, not copy- or viewport-specific.
      test("a revealed word never re-dims through the tallest block", async ({ page }) => {
        test.skip(locale !== "en" || viewport.width !== 1280, "block-geometry contract")
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await page.goto(`/${locale}/manifesto`)
        await page.evaluate(waitForReadingBlocks)
        const tallest = await page.evaluate(() => {
          let best: { top: number; height: number } | null = null
          for (const block of Array.from(document.querySelectorAll<HTMLElement>(".lit-read"))) {
            const rect = block.getBoundingClientRect()
            if (!best || rect.height > best.height) {
              best = { top: rect.top + scrollY, height: rect.height }
            }
          }
          return best
        })
        expect(tallest).not.toBeNull()
        const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
        const litStates = new Map<number, boolean>()
        const startY = Math.max(0, Math.round(tallest!.top - viewport.height))
        const endY = Math.min(maxY, Math.round(tallest!.top + tallest!.height))
        for (let y = startY; y <= endY; y += 60) {
          await page.evaluate(scrollSecret, y)
          await page.evaluate(
            () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
          )
          const lit = await page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>(".lit-read .lit-word")).map(
              (word, index) => ({
                index,
                lit: Number.parseFloat(getComputedStyle(word).getPropertyValue("--lit-local")) >= 1,
              }),
            ),
          )
          for (const { index, lit: isLit } of lit) {
            if (litStates.get(index) === true) {
              expect(isLit, `revealed word ${index} re-dimmed at scrollY ${y}`).toBe(true)
            } else {
              litStates.set(index, isLit)
            }
          }
        }
      })
    })
  }
}
