/// <reference types="bun-types" />
import { expect, test } from "bun:test"
import { createOmoDelegationRouting, OMO_DELEGATION_RULE, type OmoRoutingEvent } from "./delegation-routing"

const route = createOmoDelegationRouting(["Localized OMO Display Name"])

for (const agent of ["oracle", "oh-my-openagent/oracle", "Sisyphus - ultraworker", "Sisyphus-Junior", "Localized OMO Display Name"]) {
  test(`filters only native subagent for owned OMO identity ${agent}`, () => {
    const event: OmoRoutingEvent = { agent, system: [], tools: { subagent: {}, execute: {}, task: {}, other: {} } }
    route(event, { hideNativeTool: true })
    expect(Object.hasOwn(event.tools!, "subagent")).toBe(false)
    expect(Object.keys(event.tools!).sort()).toEqual(["execute", "other", "task"])
    expect(event.system).toEqual([{ type: "text", text: OMO_DELEGATION_RULE }])
    route(event, { hideNativeTool: true })
    expect(event.system).toHaveLength(1)
  })
}

for (const agent of ["general", "build", "plan", "custom", "oh-my-openagent/custom", "oracle-custom", "compaction", "ocBuilder", undefined]) {
  test(`leaves non-OMO identity ${agent} untouched`, () => {
    const event: OmoRoutingEvent = { agent, system: [{ type: "text", text: "original" }], tools: { subagent: {}, execute: {} } }
    const before = structuredClone(event)
    route(event, { hideNativeTool: true })
    expect(event).toEqual(before)
  })
}

test("prompt-only mode retains native tool; filter is explicitly opted in", () => {
  const event: OmoRoutingEvent = { agent: "oracle", system: [], tools: { subagent: {} } }
  route(event)
  expect(Object.hasOwn(event.tools!, "subagent")).toBe(true)
  expect(event.system).toEqual([{ type: "text", text: OMO_DELEGATION_RULE }])
})

test("agent switch removes only our stale prompt from native context", () => {
  const original = { type: "text" as const, text: "original" }
  const event: OmoRoutingEvent = { agent: "general", system: [original, { type: "text", text: OMO_DELEGATION_RULE }], tools: { subagent: {} } }
  route(event, { hideNativeTool: true })
  expect(event.system).toEqual([original])
  expect(Object.hasOwn(event.tools!, "subagent")).toBe(true)
})

test("native primary identities cannot be claimed through additional OMO aliases", () => {
  const attempt = createOmoDelegationRouting(["general", "build", "plan"])
  for (const agent of ["general", "build", "plan"]) {
    const event: OmoRoutingEvent = { agent, system: [], tools: { subagent: {} } }
    attempt(event, { hideNativeTool: true })
    expect(event.system).toEqual([])
    expect(Object.hasOwn(event.tools!, "subagent")).toBe(true)
  }
})
