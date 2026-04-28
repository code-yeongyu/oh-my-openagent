import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
      captureDaily: true,
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
      captureDaily: true,
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
      captureDaily: true,
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
      captureDaily: false,
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })

  it("reads legacy hourly state without crashing", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const cachePath = join(dataHomePath, "oh-my-opencode")
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(
      join(cachePath, "posthog-activity.json"),
      `${JSON.stringify({
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
      captureDaily: true,
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })

  it("preserves lastPluginLoadedDayUTC when writing lastActiveDayUTC", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const cachePath = join(dataHomePath, "oh-my-opencode")
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(
      join(cachePath, "posthog-activity.json"),
      `${JSON.stringify({
        lastActiveDayUTC: "2026-04-10",
        lastPluginLoadedDayUTC: "2026-04-11",
      })}\n`,
    )
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    getPostHogActivityCaptureState(new Date("2026-04-11T10:15:00.000Z"))

    // then
    const persistedState = JSON.parse(
      readFileSync(join(cachePath, "posthog-activity.json"), "utf-8"),
    )
    expect(persistedState).toEqual({
      lastActiveDayUTC: "2026-04-11",
      lastPluginLoadedDayUTC: "2026-04-11",
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })
})

describe("getPluginLoadedCaptureState", () => {
  it("returns capturePluginLoaded=true when activity file does not exist", async () => {
    // given
    const dataHomePath = createDataHomePath()
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPluginLoadedCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPluginLoadedCaptureState(new Date("2026-04-11T10:15:00.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-04-11",
      capturePluginLoaded: true,
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })

  it("returns capturePluginLoaded=false when lastPluginLoadedDayUTC matches today", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const cachePath = join(dataHomePath, "oh-my-opencode")
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(
      join(cachePath, "posthog-activity.json"),
      `${JSON.stringify({
        lastPluginLoadedDayUTC: "2026-04-11",
      })}\n`,
    )
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPluginLoadedCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPluginLoadedCaptureState(new Date("2026-04-11T10:15:00.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-04-11",
      capturePluginLoaded: false,
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })

  it("returns capturePluginLoaded=true when lastPluginLoadedDayUTC is from a previous day", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const cachePath = join(dataHomePath, "oh-my-opencode")
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(
      join(cachePath, "posthog-activity.json"),
      `${JSON.stringify({
        lastPluginLoadedDayUTC: "2026-04-10",
      })}\n`,
    )
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPluginLoadedCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPluginLoadedCaptureState(new Date("2026-04-11T10:15:00.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-04-11",
      capturePluginLoaded: true,
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })

  it("preserves lastActiveDayUTC when writing lastPluginLoadedDayUTC", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const cachePath = join(dataHomePath, "oh-my-opencode")
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(
      join(cachePath, "posthog-activity.json"),
      `${JSON.stringify({
        lastActiveDayUTC: "2026-04-11",
        lastPluginLoadedDayUTC: "2026-04-10",
      })}\n`,
    )
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPluginLoadedCaptureState } = await importPostHogActivityStateModule()

    // when
    getPluginLoadedCaptureState(new Date("2026-04-11T10:15:00.000Z"))

    // then
    const persistedState = JSON.parse(
      readFileSync(join(cachePath, "posthog-activity.json"), "utf-8"),
    )
    expect(persistedState).toEqual({
      lastActiveDayUTC: "2026-04-11",
      lastPluginLoadedDayUTC: "2026-04-11",
    })

    rmSync(dataHomePath, { recursive: true, force: true })
  })

  it("does not rewrite state when lastPluginLoadedDayUTC matches today", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const cachePath = join(dataHomePath, "oh-my-opencode")
    mkdirSync(cachePath, { recursive: true })
    const initialPayload = `${JSON.stringify({
      lastActiveDayUTC: "2026-04-10",
      lastPluginLoadedDayUTC: "2026-04-11",
    })}\n`
    writeFileSync(join(cachePath, "posthog-activity.json"), initialPayload)
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPluginLoadedCaptureState } = await importPostHogActivityStateModule()

    // when
    getPluginLoadedCaptureState(new Date("2026-04-11T10:15:00.000Z"))

    // then
    const persistedPayload = readFileSync(join(cachePath, "posthog-activity.json"), "utf-8")
    expect(persistedPayload).toBe(initialPayload)

    rmSync(dataHomePath, { recursive: true, force: true })
  })
})
