/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  buildCloseArgs,
  buildListPanesArgs,
  buildRenameArgs,
  buildRunArgs,
  buildSplitArgs,
  getWorkspaceIdFromPaneId,
  isHerdrPaneId,
  parsePaneIdFromOutput,
  parsePaneIdsFromListOutput,
} from "./pane-utils"

describe("pane id helpers", () => {
  test("isHerdrPaneId accepts w1:p2", () => {
    expect(isHerdrPaneId("w1:p2")).toBe(true)
    expect(isHerdrPaneId("w12:p345")).toBe(true)
    expect(isHerdrPaneId("wJ:p1")).toBe(true)
    expect(isHerdrPaneId("wA:p10")).toBe(true)
    expect(isHerdrPaneId("w1:t2")).toBe(false)
    expect(isHerdrPaneId("pane-1")).toBe(false)
  })

  test("getWorkspaceIdFromPaneId extracts the workspace prefix", () => {
    expect(getWorkspaceIdFromPaneId("w1:p2")).toBe("w1")
    expect(getWorkspaceIdFromPaneId("w12:p1")).toBe("w12")
    expect(getWorkspaceIdFromPaneId("wJ:p1")).toBe("wJ")
    expect(getWorkspaceIdFromPaneId("nope")).toBeUndefined()
  })

  test("parsePaneIdFromOutput finds the first pane id", () => {
    expect(parsePaneIdFromOutput("Created w1:p2")).toBe("w1:p2")
    expect(parsePaneIdFromOutput("Created wJ:p2")).toBe("wJ:p2")
    expect(parsePaneIdFromOutput("no pane here")).toBeUndefined()
  })

  test("parsePaneIdsFromListOutput extracts every pane id line", () => {
    const output = ["w1:p1", "w1:p2", "label line", ""].join("\n")
    expect(parsePaneIdsFromListOutput(output)).toEqual(["w1:p1", "w1:p2"])
  })
})

describe("command builders", () => {
  test("buildSplitArgs", () => {
    expect(buildSplitArgs({ callerPaneId: "w1:p1", direction: "right", ratio: 0.7, cwd: "/tmp/x" })).toEqual([
      "pane", "split", "w1:p1", "--direction", "right", "--ratio", "0.7", "--cwd", "/tmp/x",
    ])
    expect(buildSplitArgs({ callerPaneId: "w1:p1", direction: "down" })).toEqual([
      "pane", "split", "w1:p1", "--direction", "down",
    ])
  })

  test("buildRenameArgs", () => {
    expect(buildRenameArgs("w1:p2", "omo-team-123")).toEqual(["pane", "rename", "w1:p2", "omo-team-123"])
  })

  test("buildRunArgs", () => {
    expect(buildRunArgs("w1:p2", "opencode attach http://x")).toEqual(["pane", "run", "w1:p2", "opencode attach http://x"])
  })

  test("buildCloseArgs", () => {
    expect(buildCloseArgs("w1:p2")).toEqual(["pane", "close", "w1:p2"])
  })

  test("buildListPanesArgs", () => {
    expect(buildListPanesArgs("w1")).toEqual(["pane", "list", "--workspace", "w1"])
    expect(buildListPanesArgs()).toEqual(["pane", "list"])
  })
})
