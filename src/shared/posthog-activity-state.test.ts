import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const originalXdgDataHome = process.env.XDG_DATA_HOME

function createDataHomePath(): string {
  return join(tmpdir(), `posthog-activity-state-${Date.now()}-${Math.random()}`)
}

async function importPostHogActivityStateModule(): Promise<typeof import("./posthog-activity-state")> {
  return import(`./posthog-activity-state?test=${Date.now()}-${Math.random()}`)
}

afterEach(() => {
  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME
  } else {
    process.env.XDG_DATA_HOME = originalXdgDataHome
  }
})

describe("getPostHogActivityCaptureState", () => {
  it("returns default state when activity file contains null", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const cachePath = join(dataHomePath, "oh-my-opencode")
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(join(cachePath, "posthog-activity.json"), "null\n")
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPostHogActivityCaptureState(new Date("2026-04-11T10:15:00.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-04-11",
      hourUTC: "2026-04-11T10",
      captureDaily: true,
      captureHourly: true,
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })

  it("returns default state when activity file contains an array", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const cachePath = join(dataHomePath, "oh-my-opencode")
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(join(cachePath, "posthog-activity.json"), "[]\n")
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPostHogActivityCaptureState(new Date("2026-04-11T10:15:00.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-04-11",
      hourUTC: "2026-04-11T10",
      captureDaily: true,
      captureHourly: true,
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })

  it("returns default state when activity file contains a number", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const cachePath = join(dataHomePath, "oh-my-opencode")
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(join(cachePath, "posthog-activity.json"), "42\n")
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPostHogActivityCaptureState(new Date("2026-04-11T10:15:00.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-04-11",
      hourUTC: "2026-04-11T10",
      captureDaily: true,
      captureHourly: true,
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })

  it("reads valid activity state JSON", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const cachePath = join(dataHomePath, "oh-my-opencode")
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(
      join(cachePath, "posthog-activity.json"),
      `${JSON.stringify({
        lastActiveDayUTC: "2026-04-11",
        lastActiveHourUTC: "2026-04-11T10",
      })}\n`,
    )
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPostHogActivityCaptureState(new Date("2026-04-11T10:15:00.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-04-11",
      hourUTC: "2026-04-11T10",
      captureDaily: false,
      captureHourly: false,
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })
})
