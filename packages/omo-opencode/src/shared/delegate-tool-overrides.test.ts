import { expect, test } from "bun:test"

import { getAgentToolRestrictions } from "./agent-tool-restrictions"
import { buildDelegateSessionPermission } from "./delegate-tool-overrides"

test("buildDelegateSessionPermission keeps hard tool denies above category allows", () => {
  //#given
  const configuredTools = {
    grep: false,
    glob: true,
    question: true,
    task: true,
    team_create: true,
  }

  //#when
  const rules = buildDelegateSessionPermission(
    configuredTools,
    getAgentToolRestrictions("sisyphus-junior"),
  )

  //#then
  expect(rules).toContainEqual(
    { permission: "grep", action: "deny", pattern: "*" },
  )
  expect(rules).toContainEqual(
    { permission: "glob", action: "allow", pattern: "*" },
  )
  expect(rules).toContainEqual(
    { permission: "question", action: "deny", pattern: "*" },
  )
  expect(rules).toContainEqual(
    { permission: "task", action: "deny", pattern: "*" },
  )
  expect(rules).toContainEqual(
    { permission: "team_create", action: "deny", pattern: "*" },
  )
  expect(rules).not.toContainEqual(
    { permission: "task", action: "allow", pattern: "*" },
  )
  expect(rules).not.toContainEqual(
    { permission: "team_create", action: "allow", pattern: "*" },
  )
})

test("buildDelegateSessionPermission keeps GPT Sisyphus-Junior apply_patch denied above category allows", () => {
  //#given
  const configuredTools = {
    apply_patch: true,
  }

  //#when
  const rules = buildDelegateSessionPermission(
    configuredTools,
    getAgentToolRestrictions("sisyphus-junior", { model: "openai/gpt-5.4-mini" }),
  )

  //#then
  expect(rules).toContainEqual(
    { permission: "apply_patch", action: "deny", pattern: "*" },
  )
  expect(rules).not.toContainEqual(
    { permission: "apply_patch", action: "allow", pattern: "*" },
  )
})
