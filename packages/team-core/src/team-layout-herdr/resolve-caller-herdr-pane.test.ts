/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import { getWorkspaceIdFromPaneId, isHerdrPaneId } from "@oh-my-opencode/herdr-core"
import { resolveCallerHerdrPane } from "./resolve-caller-herdr-pane"

const SAVED_ENV = {
  HERDR_PANE_ID: process.env.HERDR_PANE_ID,
}

afterEach(() => {
  if (SAVED_ENV.HERDR_PANE_ID === undefined) {
    delete process.env.HERDR_PANE_ID
  } else {
    process.env.HERDR_PANE_ID = SAVED_ENV.HERDR_PANE_ID
  }
})

describe("resolveCallerHerdrPane", () => {
  test("resolves a caller pane id to workspace + pane", async () => {
    const resolved = await resolveCallerHerdrPane("w1:p2")
    expect(resolved).toEqual({ workspaceId: "w1", paneId: "w1:p2" })
  })

  test("resolves alphanumeric workspace ids (herdr's real format)", async () => {
    const resolved = await resolveCallerHerdrPane("wJ:p1")
    expect(resolved).toEqual({ workspaceId: "wJ", paneId: "wJ:p1" })
  })

  test("returns null without a caller pane id", async () => {
    delete process.env.HERDR_PANE_ID
    expect(await resolveCallerHerdrPane(undefined)).toBeNull()
  })

  test("falls back to HERDR_PANE_ID env when no arg is given", async () => {
    process.env.HERDR_PANE_ID = "w1:p7"
    const resolved = await resolveCallerHerdrPane()
    expect(resolved).toEqual({ workspaceId: "w1", paneId: "w1:p7" })
  })

  test("returns null for a malformed pane id", async () => {
    expect(await resolveCallerHerdrPane("pane-1")).toBeNull()
  })
})

describe("getWorkspaceIdFromPaneId / isHerdrPaneId (re-export sanity)", () => {
  test("workspace prefix extraction", () => {
    expect(getWorkspaceIdFromPaneId("w1:p1")).toBe("w1")
  })

  test("pane id shape check", () => {
    expect(isHerdrPaneId("w1:p1")).toBe(true)
  })
})
