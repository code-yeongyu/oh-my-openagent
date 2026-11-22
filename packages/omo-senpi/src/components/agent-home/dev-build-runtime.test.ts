import { expect, test } from "bun:test"
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
