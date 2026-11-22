import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isSharedAgentDir } from "./dev-build-runtime"

test("#given HOME and USERPROFILE name different roots #when the agent dir is the USERPROFILE store #then it is shared", () => {
  const shellHome = join("/", "shell-home")
  const profileHome = join("/", "profile-home")
  expect(isSharedAgentDir(join(profileHome, ".omo", "agent"), [shellHome, profileHome])).toBe(true)
  expect(isSharedAgentDir(join(shellHome, ".senpi", "agent"), [shellHome, profileHome])).toBe(true)
})

test("#given several home roots #when the agent dir is an isolated dir #then it is not shared", () => {
  expect(
    isSharedAgentDir(join("/", "tmp", "isolated-agent"), [join("/", "shell-home"), join("/", "profile-home")]),
  ).toBe(false)
})

test("#given the process env #when USERPROFILE differs from HOME #then the USERPROFILE store counts as shared", () => {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  try {
    process.env.HOME = join("/", "shell-home")
    process.env.USERPROFILE = join("/", "profile-home")
    expect(isSharedAgentDir(join("/", "profile-home", ".omo", "agent"))).toBe(true)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("#given an existing shared store #when the agent dir spells it with different case on a case-insensitive volume #then it is shared", () => {
  const home = mkdtempSync(join(tmpdir(), "agent-home-case-"))
  try {
    mkdirSync(join(home, ".omo", "agent"), { recursive: true })
    const upper = join(home, ".OMO", "AGENT")
    let caseInsensitive = true
    try {
      mkdirSync(join(home, ".omo", "Probe"))
      mkdirSync(join(home, ".omo", "probe"))
      caseInsensitive = false
    } catch {}
    expect(isSharedAgentDir(upper, [home])).toBe(caseInsensitive)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("#given a shared store not created yet #when the agent dir spells it with different case #then it is shared where the platform's volumes ignore case", () => {
  const home = join(tmpdir(), "agent-home-absent-case")
  const caseInsensitivePlatform = process.platform === "win32" || process.platform === "darwin"
  expect(isSharedAgentDir(join(home, ".OMO", "Agent"), [home])).toBe(caseInsensitivePlatform)
})
