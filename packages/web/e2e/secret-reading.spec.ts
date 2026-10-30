import { writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"

import { readSecret, scrollSecret, waitForSecret } from "./secret-reading-state"

for (const locale of ["en", "ko"]) {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 900 },
  ]) {
    test.describe(`${locale} ${viewport.width}`, () => {
      test.use({ viewport })

      for (const variant of [
        "timeline",
        "fallback",
        "tall-timeline",
        "tall-fallback",
        "registration",
        "inactive",
      ]) {
        test(`reading hold and reversible reveal (${variant})`, async ({ page }, testInfo) => {
          await page.emulateMedia({ reducedMotion: "no-preference" })
          if (variant.includes("fallback")) {
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
          if (variant === "registration") {
            await page.addInitScript(() => {
              // Fault injection only: never register a property from a measurement probe.
              CSS.registerProperty = () => {
                throw new DOMException("Registration unavailable", "NotSupportedError")
              }
            })
          }
          if (variant === "inactive") {
            await page.route("**/*.css", async (route) => {
              const response = await route.fetch()
              await route.fulfill({
                response,
                body: `${await response.text()}\n.lit-text { view-timeline-name: --unbound-test !important; }`,
              })
            })
          }
          await page.goto(`/${locale}`)
          await page.evaluate(waitForSecret)
          if (variant.startsWith("tall")) {
            await page.locator(".lit-text").evaluate((body) => {
              body.style.maxWidth = "130px"
              body.style.minHeight = "120vh"
            })
          }
          const initial = await page.evaluate(readSecret)
          expect(initial.mode).toBe(variant.endsWith("timeline") ? "timeline" : "fallback")
          if (variant.startsWith("tall"))
            expect(initial.body.height).toBeGreaterThan(viewport.height)
          const end = initial.scrollY + initial.body.bottom - viewport.height / 2
          const start = initial.scrollY + initial.body.top - viewport.height * 0.8
          const samples: Array<ReturnType<typeof readSecret> & { name: string }> = []
          const sample = async (name: string, y: number) => {
            await page.evaluate(scrollSecret, y)
            const state = await page.evaluate(readSecret)
            samples.push({ name, ...state })
            const path = testInfo.outputPath(`${name}.png`)
            await page.screenshot({ path })
            await testInfo.attach(name, { path, contentType: "image/png" })
            return state
          }
          try {
            const early = await sample("words-early", start + (end - start) * 0.25)
            const middle = await sample("words-middle", start + (end - start) * 0.6)
            expect(early.words.some((word) => word.fill > 0 && word.fill < 100)).toBe(true)
            expect(middle.words.some((word) => word.fill > 0 && word.fill < 100)).toBe(true)
            expect(middle.words.filter((word) => word.fill >= 99.9).length).toBeGreaterThan(
              early.words.filter((word) => word.fill >= 99.9).length,
            )
            expect(middle.opacity).toBe(0)

            const complete = await sample("words-complete-follow-hidden", end + 2)
            expect(complete.words.every((word) => word.fill >= 99.9)).toBe(true)
            expect(complete.opacity).toBe(0)
            const midpoint = await sample(
              "follow-at-midpoint-hidden",
              initial.scrollY + initial.follow.flowTop - viewport.height / 2,
            )
            expect(midpoint.opacity).toBe(0)
            const hold = await sample("extra-reading-follow-hidden", end + viewport.height * 0.15)
            expect(hold.words.every((word) => word.fill >= 99.9)).toBe(true)
            expect(hold.opacity).toBe(0)

            // The reveal has its own scroll interval, beyond the completed word sweep.
            const trigger = Math.max(
              end + viewport.height * 0.18,
              initial.scrollY + initial.follow.flowTop - viewport.height / 2,
            )
            for (const [name, offset] of [
              ["just-before-trigger", -2],
              ["just-after-trigger", viewport.height * 0.025],
              ["follow-halfway", viewport.height * 0.11],
              ["follow-complete", viewport.height * 0.22 + 2],
              ["reverse-halfway", viewport.height * 0.11],
              ["reverse-hidden", -2],
            ] as const) {
              const state = await sample(name, trigger + offset)
              expect(state.words.every((word) => word.fill >= 99.9)).toBe(true)
              if (offset < 0) expect(state.opacity).toBe(0)
              else {
                expect(state.opacity).toBeGreaterThan(0)
                expect(state.follow.flowTop).toBeLessThanOrEqual(viewport.height / 2)
                expect(state.follow.top).toBeGreaterThan(state.headerBottom)
                expect(state.follow.bottom).toBeLessThan(viewport.height)
                if (offset > viewport.height * 0.22) expect(state.opacity).toBe(1)
                else expect(state.opacity).toBeLessThan(1)
              }
            }
            const reverse = await sample("reverse-words", start + (end - start) * 0.6)
            expect(reverse.words.some((word) => word.fill > 0 && word.fill < 100)).toBe(true)
            expect(reverse.opacity).toBe(0)
          } finally {
            const path = testInfo.outputPath("geometry-and-gradients.json")
            await writeFile(path, JSON.stringify(samples, null, 2))
            await testInfo.attach("geometry-and-gradients", {
              path,
              contentType: "application/json",
            })
          }
        })
      }

      test("reduced motion is fully readable", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" })
        await page.goto(`/${locale}`)
        await page.evaluate(waitForSecret)
        const state = await page.evaluate(readSecret)
        expect(state.opacity).toBe(1)
        expect(state.follow.transform).toBe("none")
        expect(state.words.every((word) => word.gradient === "none" && word.blur === "none")).toBe(
          true,
        )
      })
    })
  }
}
