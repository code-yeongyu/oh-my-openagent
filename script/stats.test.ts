import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { collectDownloadStats, createPostHogDownloadEvents } from "./stats"

describe("download stats automation", () => {
  test("#given package and release counts #when collected #then stats use aggregate download sources", async () => {
    // given
    const stats = await collectDownloadStats({
      fetchJson: async (url) => ({ downloads: url.includes("lazycodex-ai") ? 30 : 10 }),
      runGhApi: async () => [
        { assets: [{ download_count: 4 }, { download_count: 6 }] },
        { assets: [{ download_count: 9 }] },
      ],
    })

    // when
    const events = createPostHogDownloadEvents(stats, "test-key")

    // then
    expect(events).toContainEqual({
      api_key: "test-key",
      event: "omo_download_stats",
      distinct_id: "download",
      properties: {
        $process_person_profile: false,
        count: 19,
        package_name: "code-yeongyu/oh-my-openagent",
        source: "github_release",
      },
    })
    expect(events.filter((event) => event.properties.source === "npm")).toHaveLength(3)
  })

  test("#given slurped GitHub release pages #when collected #then stats aggregate every page", async () => {
    // given
    const stats = await collectDownloadStats({
      fetchJson: async () => ({ downloads: 1 }),
      runGhApi: async () => [
        [{ assets: [{ download_count: 4 }, { download_count: 6 }] }],
        [{ assets: [{ download_count: 9 }] }],
      ],
    })

    // when
    const githubStat = stats.find((stat) => stat.source === "github_release")

    // then
    expect(githubStat).toEqual({
      count: 19,
      packageName: "code-yeongyu/oh-my-openagent",
      source: "github_release",
    })
  })

  test("#given stats workflow #when inspected #then it is weekly manual and scopes POSTHOG_KEY to send only", async () => {
    // given
    const workflow = await readFile(".github/workflows/stats.yml", "utf8")
    const fetchStepIndex = workflow.indexOf("name: Fetch download stats")
    const sendStepIndex = workflow.indexOf("name: Send download stats")

    // when / then
    expect(workflow).toContain("schedule:")
    expect(workflow).toContain('cron: "0 0 * * 0"')
    expect(workflow).toContain("workflow_dispatch:")
    expect(workflow).not.toContain("pull_request")
    expect(workflow).toContain("contents: read")
    expect(fetchStepIndex).toBeGreaterThanOrEqual(0)
    expect(sendStepIndex).toBeGreaterThan(fetchStepIndex)
    expect(workflow.slice(fetchStepIndex, sendStepIndex)).toContain("GH_TOKEN: ${{ github.token }}")
    expect(workflow.slice(fetchStepIndex, sendStepIndex)).not.toContain("POSTHOG_KEY")
    expect(workflow.slice(sendStepIndex)).toContain("GH_TOKEN: ${{ github.token }}")
    expect(workflow.slice(sendStepIndex)).toContain("POSTHOG_KEY: ${{ secrets.POSTHOG_KEY }}")
  })
})
