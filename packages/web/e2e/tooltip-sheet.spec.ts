import { expect, test } from "@playwright/test"

test.describe("Icon control tooltip", () => {
  test("keyboard focus on the Fit button shows its tooltip and Escape dismisses it", async ({
    page,
  }) => {
    // given
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")
    const fit = page.getByTestId("hero-dag").getByRole("button", { name: "Fit graph" })
    const tooltip = page.getByTestId("hero-dag").getByRole("tooltip", { name: "Fit graph" })
    await expect(tooltip).toBeHidden()

    // when
    await fit.focus()

    // then
    await expect(tooltip).toBeVisible()
    await expect(fit).toHaveAttribute("aria-describedby", (await tooltip.getAttribute("id")) ?? "")

    // when
    await page.keyboard.press("Escape")

    // then
    await expect(tooltip).toBeHidden()
    await expect(fit).toBeFocused()
  })

  test("pointer hover on the Fit button shows its tooltip", async ({ page }) => {
    // given
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")
    const dag = page.getByTestId("hero-dag")

    // when
    await dag.getByRole("button", { name: "Fit graph" }).hover()

    // then
    await expect(dag.getByRole("tooltip", { name: "Fit graph" })).toBeVisible()
  })

  test("the pointer can move from the button onto its tooltip without it closing", async ({
    page,
  }) => {
    // given
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")
    const dag = page.getByTestId("hero-dag")
    const tooltip = dag.getByRole("tooltip", { name: "Fit graph" })
    await dag.getByRole("button", { name: "Fit graph" }).hover()
    await expect(tooltip).toBeVisible()
    const box = await tooltip.boundingBox()
    if (box === null) throw new Error("tooltip has no box while visible")

    // when
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 })

    // then
    await expect(tooltip).toBeVisible()
  })

  test("Escape dismisses a hover-opened tooltip and it stays dismissed while hovered", async ({
    page,
  }) => {
    // given
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")
    const dag = page.getByTestId("hero-dag")
    const button = dag.getByRole("button", { name: "Fit graph" })
    const tooltip = dag.getByRole("tooltip", { name: "Fit graph" })
    await button.hover()
    await expect(tooltip).toBeVisible()

    // when
    await page.keyboard.press("Escape")
    await button.hover({ position: { x: 4, y: 4 } })

    // then
    await expect(tooltip).toBeHidden()
  })
})
