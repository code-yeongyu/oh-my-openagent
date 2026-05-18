import { test, expect } from "@playwright/test"

test("homepage renders heading", async ({ page }) => {
  // given
  await page.goto("/")

  // when
  const heading = page.getByRole("heading", { name: "The Best Agent Harness", level: 1 })

  // then
  await expect(heading).toBeVisible()
})

test("homepage renders description", async ({ page }) => {
  // given
  await page.goto("/")

  // when
  const description = page.getByText("The Best Agent Harness").first()

  // then
  await expect(description).toBeVisible()
})
