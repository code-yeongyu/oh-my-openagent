import { describe, expect, test } from "bun:test"

import { reinstallStep } from "./reinstall-step"

// Contract: omo-native's launcher sets OMO_REINSTALL_COMMAND (engine-environment.js, pinned by launcher.test.ts);
// the plugin names exactly that command, and nothing when another launch left it unset.
describe("reinstallStep", () => {
  test.each(["bun add -g omo-ai@beta", "bun add -g omo-ai", "npm i -g omo-ai@beta", "npm i -g omo-ai"])("#given the launcher's command %s #then the step carries that exact command", (command) => {
    expect(reinstallStep({ OMO_REINSTALL_COMMAND: command }).split(": ")[1]).toBe(command)
  })

  test("#given no or a blank OMO_REINSTALL_COMMAND #then no command is named", () => {
    expect(reinstallStep({})).not.toContain(":")
    expect(reinstallStep({ OMO_REINSTALL_COMMAND: "  " })).not.toContain(":")
  })
})
