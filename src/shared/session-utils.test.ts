import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test"
import { initializeAgentNameAliases, resetAgentNameAliases } from "./agent-name-aliases"
import * as sessionUtils from "./session-utils"

describe("session-utils", () => {
  let getMessageDirSpy: ReturnType<typeof spyOn>
  let findNearestSpy: ReturnType<typeof mock>

  beforeEach(() => {
    resetAgentNameAliases()
    getMessageDirSpy = spyOn(sessionUtils, "getMessageDir").mockReturnValue("/tmp/fake-dir")
  })

  test("returns false when sessionID is undefined", () => {
    expect(sessionUtils.isCallerOrchestrator(undefined)).toBe(false)
  })

  test("returns false when no message directory exists", () => {
    getMessageDirSpy.mockReturnValue(null)
    expect(sessionUtils.isCallerOrchestrator("ses_test")).toBe(false)
  })

  test("returns true when nearest message agent is atlas", () => {
    const injector = require("../features/hook-message-injector")
    spyOn(injector, "findNearestMessageWithFields").mockReturnValue({ agent: "atlas" })

    expect(sessionUtils.isCallerOrchestrator("ses_test")).toBe(true)
  })

  test("returns true for Atlas with different casing", () => {
    const injector = require("../features/hook-message-injector")
    spyOn(injector, "findNearestMessageWithFields").mockReturnValue({ agent: "Atlas" })

    expect(sessionUtils.isCallerOrchestrator("ses_test")).toBe(true)
  })

  test("returns false when nearest message agent is not atlas", () => {
    const injector = require("../features/hook-message-injector")
    spyOn(injector, "findNearestMessageWithFields").mockReturnValue({ agent: "sisyphus" })

    expect(sessionUtils.isCallerOrchestrator("ses_test")).toBe(false)
  })

  test("canonicalizes renamed atlas agent when checking orchestrator", () => {
    initializeAgentNameAliases(
      { atlas: "Master Orchestrator" },
      ["atlas", "sisyphus", "prometheus"],
    )

    const injector = require("../features/hook-message-injector")
    spyOn(injector, "findNearestMessageWithFields").mockReturnValue({ agent: "Master Orchestrator" })

    expect(sessionUtils.isCallerOrchestrator("ses_test")).toBe(true)
  })

  test("returns false when agent field is missing from nearest message", () => {
    const injector = require("../features/hook-message-injector")
    spyOn(injector, "findNearestMessageWithFields").mockReturnValue({})

    expect(sessionUtils.isCallerOrchestrator("ses_test")).toBe(false)
  })
})
