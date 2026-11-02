import { expect, test } from "@playwright/test"

test.describe("Support page (Report a problem landing)", () => {
  test("#given the desktop report query #when the page opens #then the report is shown as text and handed to a prefilled GitHub issue", async ({
    page,
  }) => {
    // given
    const body = "Steps\n1. open Settings\n<script>window.__pwned = 1</script>"
    const response = await page.goto(
      `/ko/support?title=${encodeURIComponent("Anthropic sign-in missing")}&body=${encodeURIComponent(body)}`,
    )

    // then
    expect(response?.status()).toBe(200)
    await expect(page.getByTestId("support-report-title")).toHaveText("Anthropic sign-in missing")
    await expect(page.getByTestId("support-report-body")).toContainText(
      "<script>window.__pwned = 1</script>",
    )
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined()
    const href = await page.getByRole("link", { name: "GitHub 이슈 열기" }).getAttribute("href")
    const issue = new URL(href ?? "")
    expect(`${issue.origin}${issue.pathname}`).toBe(
      "https://github.com/code-yeongyu/oh-my-openagent/issues/new",
    )
    expect(issue.searchParams.get("title")).toBe("Anthropic sign-in missing")
  })

  test("#given no query #when the page opens #then it is a plain support page", async ({
    page,
  }) => {
    const response = await page.goto("/support")

    expect(response?.status()).toBe(200)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get help with OmO")
    await expect(page.getByTestId("support-report-body")).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Ask on Discord" })).toHaveAttribute(
      "href",
      "https://discord.gg/PUwSMR9XNk",
    )
  })

  test("#given a very long report #when the page opens #then it renders and the issue link stays within the URL budget", async ({
    page,
  }) => {
    const response = await page.goto(
      `/support?title=Long&body=${encodeURIComponent("x".repeat(15_000))}`,
    )

    expect(response?.status()).toBe(200)
    const href = await page.getByRole("link", { name: "Open a GitHub issue" }).getAttribute("href")
    expect((href ?? "").length).toBeLessThanOrEqual(7_000)
  })
})
