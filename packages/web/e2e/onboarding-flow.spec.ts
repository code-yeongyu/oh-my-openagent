import { expect, test } from "@playwright/test"

test.describe("Landing checkout onboarding", () => {
  test("moves an email lead through checkout and automation confirmation", async ({ page }) => {
    // given
    await page.goto("/en")
    const email = "founder@example.com"

    // when
    await page.getByLabel("Work email").fill(email)
    await Promise.all([
      page.waitForURL(/\/checkout\?email=founder%40example\.com/),
      page.getByRole("button", { name: "Continue to checkout" }).click(),
    ])

    // then
    await expect(page.getByRole("heading", { name: "Confirm the launch pipeline" })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()

    // when
    await Promise.all([
      page.waitForURL(/\/result\?email=founder%40example\.com&status=paid/),
      page.getByRole("link", { name: "Confirm payment" }).click(),
    ])

    // then
    await expect(page.getByRole("heading", { name: "Automation workspace ready" })).toBeVisible()
    await expect(page.getByRole("switch", { name: "Landing page iterations" })).toBeChecked()
    await expect(page.getByRole("switch", { name: "Lifecycle email sequence" })).toBeChecked()
    await expect(page.getByText("founder@example.com")).toBeVisible()
  })
})
