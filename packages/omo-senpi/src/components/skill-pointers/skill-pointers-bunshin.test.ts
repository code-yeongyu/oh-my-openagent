import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { matchedSkillPointerNames, OMO_RELAY_CUSTOM_TYPE } from "./index"
import { dispatchInput, expectNoInjection, injectedContent, registerSkillPointers } from "./test-support"

describe("omo-senpi skill-pointers omo-relay pointer", () => {
  it("#given fleet or other-device wording #when matched #then the omo-relay pointer target fires", () => {
    const triggers = [
      "run this on builder via bunshin",
      "list my fleet",
      "run uptime on our fleet",
      "restart the fleet hosts",
      "reboot the fleet box",
      "check disk on my fleets",
      "restart fleet-node-3",
      "deploy to our fleet and verify",
      "is my fleet up?",
      "run it on my fleet, then report",
      "check the machine mesh",
      "machine-mesh health",
      "run this on my other machine",
      "check disk on our other devices",
      "fan this out with omo-relay",
    ] as const
    for (const text of triggers) {
      expect({ text, matched: matchedSkillPointerNames(text) }).toEqual({ text, matched: ["omo-relay"] })
    }
  })

  it("#given near-miss wording #when matched #then nothing fires", () => {
    const misses = [
      "fleeting thought",
      // A fleet with no device sense (#13446): the plain word names vehicles, ships or a UI, not this user's machines.
      "Fleet status please",
      "the delivery fleet schedule",
      "the fleet-dashboard css",
      // The owner form names this user's machines only as the object of the request, not as a modifier or a
      // vehicle fleet (#13467 review L3): "our fleet management UI", "our fleet of delivery trucks".
      "update our fleet management UI",
      "our fleet of delivery trucks",
      "my fleets of ships",
      "our fleet's fuel costs",
      "our fleet size grew last year",
      "the fleet hosts a regatta",
      "bunshins",
      "the mesh network",
      "machine learning",
      "`bunshin` in a code span",
      "mybunshin_helper",
      "my other machine learning project",
      "the other machine in the lab",
    ] as const
    for (const text of misses) {
      expect({ text, matched: matchedSkillPointerNames(text) }).toEqual({ text, matched: [] })
    }
  })

  it("#given an interactive prompt naming the fleet #when dispatched #then one hidden omo-relay pointer sends the agent to the skill and keeps the import safety", async () => {
    const pi = new FakeExtensionAPI()
    await registerSkillPointers(pi)
    const result = await dispatchInput(pi, "list my fleet")
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages.map((call) => [call.message["customType"], call.message["display"]])).toEqual([
      [OMO_RELAY_CUSTOM_TYPE, false],
    ])
    const content = injectedContent(pi, OMO_RELAY_CUSTOM_TYPE)
    expect(content).toStartWith("<omo-omo-relay-pointer>")
    expect(content).toContain("omo-relay/SKILL.md")
    // The forbidden entry the pointer must still carry: importing the node-agent executable exits the kernel.
    expect(content).toContain("scripts/node/bunshin-node.mjs")
  })

  it("#given the plain word fleet in an unrelated request #when dispatched #then no hidden pointer is injected (#13446)", async () => {
    const pi = new FakeExtensionAPI()
    await registerSkillPointers(pi)
    expectNoInjection(pi, await dispatchInput(pi, "the fleet dashboard CSS is broken"))
  })

  it("#given a device-operations request #when dispatched #then the hidden omo-relay pointer is still injected", async () => {
    const pi = new FakeExtensionAPI()
    await registerSkillPointers(pi)
    const result = await dispatchInput(pi, "check disk usage on every machine in my fleet")
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages.map((call) => [call.message["customType"], call.message["display"]])).toEqual([
      [OMO_RELAY_CUSTOM_TYPE, false],
    ])
  })

  it("#given a prompt without fleet wording #when dispatched #then no omo-relay pointer is injected", async () => {
    const pi = new FakeExtensionAPI()
    await registerSkillPointers(pi)
    expectNoInjection(pi, await dispatchInput(pi, "rename this variable"))
  })
})
