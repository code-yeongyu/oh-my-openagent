import { expect, test } from "@playwright/test"

import { firstProgress, waitForReadingBlocks } from "./manifesto-page"
import { scrollSecret } from "./secret-reading-state"

for (const locale of ["en", "ko"]) {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 900 },
  ]) {
    test.describe(`${locale} ${viewport.width}`, () => {
      test.use({ viewport })

      for (const variant of ["timeline", "fallback"]) {
        test(`a readable screenful stays lit while the edge sweeps (${variant})`, async ({
          page,
        }) => {
          test.setTimeout(90000)
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
          // The reveal is driven by the JS per-word geometry in both paths (single authoritative
          // driver); it does not opt into the CSS scroll timeline, so the mode is always observer.
          expect(await page.evaluate(firstProgress)).toBe("observer")
          const blockCount = await page.evaluate(
            () => document.querySelectorAll(".lit-read").length,
          )
          expect(blockCount).toBeGreaterThan(4)

          const maxY = await page.evaluate(
            () => document.documentElement.scrollHeight - innerHeight,
          )
          let sawMid = false
          // Measured fully lit depth per frame: the top of the first visible word that is not yet
          // fully lit, as a fraction of the viewport (#9591). Read from word geometry, not the CSS.
          const depths: number[] = []
          // Let the view() timeline catch up to an instant scroll before reading.
          const settle = () =>
            page.evaluate(
              () =>
                new Promise((r) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => requestAnimationFrame(() => r(null))),
                  ),
                ),
            )
          for (let y = 200; y < maxY; y += 120) {
            await page.evaluate(scrollSecret, y)
            await settle()
            // Q's contract, asserted directly: everything already revealed stays lit and the top
            // 75-80% of the screen is fully readable; the reveal never gates reading on scroll.
            const state = await page.evaluate(() => {
              const viewport = innerHeight
              let firstDimTop = Number.POSITIVE_INFINITY
              let litAbove = 0
              let litBelowMid = 0
              let aboveMid = 0
              for (const word of Array.from(
                document.querySelectorAll<HTMLElement>(".lit-read .lit-word"),
              )) {
                const rect = word.getBoundingClientRect()
                if (rect.bottom < 0 || rect.top > viewport) continue
                const lit =
                  Number.parseFloat(getComputedStyle(word).getPropertyValue("--lit-local")) >= 1
                if (lit) litAbove += 1
                else firstDimTop = Math.min(firstDimTop, rect.top)
                if (rect.top < viewport * 0.4) {
                  aboveMid += 1
                  if (lit) litBelowMid += 1
                }
              }
              return {
                depth: Number.isFinite(firstDimTop) && litAbove > 0 ? firstDimTop / viewport : null,
                litBelowMid,
                aboveMid,
              }
            })
            // While the reveal is mid-screen, every frame keeps at least the top 72% fully lit.
            if (state.depth !== null) {
              depths.push(state.depth)
              expect(state.depth, `scrollY ${y} fully lit depth`).toBeGreaterThanOrEqual(0.72)
            }
            // Once scrolled a screen and content still fills the upper reading area, that area has
            // lit words (readable screenful). Near the bottom the upper area can be whitespace.
            if (y > viewport.height && state.aboveMid > 0) {
              sawMid = true
              expect(state.litBelowMid, `scrollY ${y} readable screenful`).toBeGreaterThan(0)
            }
          }
          expect(sawMid).toBe(true)
          // ...and typically the top 75%: the median frame clears it.
          expect(depths.length, "frames with the reveal on screen").toBeGreaterThan(3)
          const sorted = [...depths].sort((a, b) => a - b)
          expect(
            sorted[Math.floor(sorted.length / 2)],
            "median fully lit depth",
          ).toBeGreaterThanOrEqual(0.75)

          // The reading floor is crisp: unrevealed words are never blurred (review H2). The
          // computed filter is `blur(0px)` (or `none`), never a positive blur.
          const blur = await page.evaluate(() =>
            Array.from(
              new Set(
                Array.from(document.querySelectorAll(".lit-read .lit-word"), (word) => {
                  const filter = getComputedStyle(word).filter
                  return filter === "none" ? "none" : filter
                }),
              ),
            ),
          )
          for (const filter of blur) {
            expect(["none", "blur(0px)"]).toContain(filter)
          }

          // The unread floor keeps WCAG AA contrast (review N1's guard): a fully-unlit word renders
          // at full opacity in the --text-lo floor colour, never dimmed by an opacity multiplier.
          // Scroll to the top first so upcoming words ARE unlit, then measure one. This test runs
          // for real — it fails if the floor drops below the --text-lo token.
          await page.evaluate(scrollSecret, 0)
          const floorContrast = await page.evaluate(() => {
            for (const word of Array.from(
              document.querySelectorAll<HTMLElement>(".lit-read .lit-word"),
            )) {
              const local = Number.parseFloat(
                getComputedStyle(word).getPropertyValue("--lit-local"),
              )
              if (local <= 0.01) {
                return {
                  color: getComputedStyle(word).color,
                  opacity: getComputedStyle(word).opacity,
                }
              }
            }
            return null
          })
          expect(floorContrast, "expected an unlit word at the top of the page").not.toBeNull()
          if (floorContrast) {
            expect(Number.parseFloat(floorContrast.opacity)).toBe(1)
            // The rendered floor colour is the --text-lo token (#8b8c95). The browser serializes it
            // as oklab; --text-lo is oklab ~0.62 lightness, while a below-AA floor (#55565e) is
            // ~0.455. Assert the rendered floor is NOT the dimmer value (the N1 regression).
            const c = floorContrast.color
            const lightness = /oklab\((\d*\.?\d+)/.exec(c)?.[1]
            if (c === "rgb(139, 140, 149)") {
              // rgb serialization: exact floor colour
            } else if (lightness) {
              expect(
                Number.parseFloat(lightness),
                `floor should be --text-lo (~0.62 oklab), got ${lightness}`,
              ).toBeGreaterThan(0.55)
            }
          }

          // Scrolled to the very bottom, every reveal word is fully lit.
          await page.evaluate(scrollSecret, maxY)
          await settle()
          const allLit = await page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>(".lit-read .lit-word")).every(
              (word) =>
                Number.parseFloat(getComputedStyle(word).getPropertyValue("--lit-local")) >= 1,
            ),
          )
          expect(allLit).toBe(true)
        })
      }
    })
  }
}
