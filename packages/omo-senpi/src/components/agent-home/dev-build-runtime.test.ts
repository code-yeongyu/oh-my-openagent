import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PlatformFacts } from "@oh-my-opencode/omo-opencode/account-home"

import { isDevBuildRuntime, isSharedAgentDir, isUnlaunchedSourceRun } from "./dev-build-runtime"

// Edge cases of the source-build guard (#14382, #14622 reviews M2-M4, M8): which agent dirs count as the account's shared
// store, which runtimes count as a source build, and how the OS account home is read without trusting the environment.

const temp = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)))

test("#given HOME and USERPROFILE name different roots #when the agent dir is the USERPROFILE store #then it is shared", () => {
  const shellHome = join("/", "shell-home")
  const profileHome = join("/", "profile-home")
  expect(isSharedAgentDir(join(profileHome, ".omo", "agent"), { homes: [shellHome, profileHome] })).toBe(true)
})

test.each([
  ["~/.omo/agent", [".omo", "agent"]],
  ["the flat ~/.omo", [".omo"]],
  ["~/.senpi/agent", [".senpi", "agent"]],
])("#given the agent dir is %s #then it is shared", (_name, segments) => {
  const home = join("/", "account-home")
  expect(isSharedAgentDir(join(home, ...segments), { homes: [home] })).toBe(true)
})

test("#given several home roots #when the agent dir is an isolated dir #then it is not shared", () => {
  expect(
    isSharedAgentDir(join("/", "tmp", "isolated-agent"), {
      homes: [join("/", "shell-home"), join("/", "profile-home")],
    }),
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

test.skipIf(process.platform === "win32")(
  "#given an agent dir that is a symlink to the shared store #then it is shared",
  () => {
    const home = temp("agent-home-link-")
    try {
      mkdirSync(join(home, ".omo", "agent"), { recursive: true })
      symlinkSync(join(home, ".omo", "agent"), join(home, "linked-agent"))
      expect(isSharedAgentDir(join(home, "linked-agent"), { homes: [home] })).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  },
)

test.skipIf(process.platform === "win32")(
  "#given a separate agent dir whose gateway/ links to the shared store's #when the store is compared #then it is shared (#14622 review M8)",
  () => {
    const home = temp("agent-home-store-link-")
    try {
      mkdirSync(join(home, ".omo", "agent", "gateway"), { recursive: true })
      mkdirSync(join(home, "isolated"), { recursive: true })
      symlinkSync(join(home, ".omo", "agent", "gateway"), join(home, "isolated", "gateway"))
      const gateway = (agentDir: string) => join(agentDir, "gateway")
      expect(isSharedAgentDir(join(home, "isolated"), { homes: [home] })).toBe(false)
      expect(isSharedAgentDir(join(home, "isolated"), { homes: [home], stores: [gateway] })).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  },
)

test.skipIf(process.platform === "win32")(
  "#given a gateway/ link to the shared store's gateway dir that does not exist yet #when the store is compared #then it is shared",
  () => {
    const home = temp("agent-home-dangling-")
    try {
      mkdirSync(join(home, "isolated"), { recursive: true })
      symlinkSync(join(home, ".omo", "agent", "gateway"), join(home, "isolated", "gateway"))
      const gateway = (agentDir: string) => join(agentDir, "gateway")
      expect(isSharedAgentDir(join(home, "isolated"), { homes: [home], stores: [gateway] })).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  },
)

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
    expect(isSharedAgentDir(upper, { homes: [home] })).toBe(caseInsensitive)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("#given a shared store not created yet #when the agent dir spells it with different case #then it is shared where the platform's volumes ignore case", () => {
  const home = join(tmpdir(), "agent-home-absent-case")
  const caseInsensitivePlatform = process.platform === "win32" || process.platform === "darwin"
  expect(isSharedAgentDir(join(home, ".OMO", "Agent"), { homes: [home] })).toBe(caseInsensitivePlatform)
})

test.each([
  ["no OMO_PACKAGE_DIR", undefined, false],
  ["a blank OMO_PACKAGE_DIR", "blank", false],
  ["no package.json", "missing", false],
  ["a package.json that is not JSON", "{", false],
  ["a release manifest (no omoBuild stamp)", JSON.stringify({ version: "5.2.0" }), false],
  ["an omoBuild stamp without a command", JSON.stringify({ omoBuild: {} }), false],
  ["an omoBuild stamp with an empty command", JSON.stringify({ omoBuild: { command: "" } }), false],
  ["an omoBuild stamp naming its command", JSON.stringify({ omoBuild: { command: "omob" } }), true],
] as const)("#given %s #then isDevBuildRuntime is %p", (_case, manifest, expected) => {
  const payload = temp("dev-build-payload-")
  try {
    if (manifest !== undefined && manifest !== "blank" && manifest !== "missing")
      writeFileSync(join(payload, "package.json"), manifest)
    const env: NodeJS.ProcessEnv =
      manifest === undefined ? {} : { OMO_PACKAGE_DIR: manifest === "blank" ? "  " : payload }
    expect(isDevBuildRuntime(env)).toBe(expected)
  } finally {
    rmSync(payload, { recursive: true, force: true })
  }
})

test.each([
  ["a .ts module with no OMO_PACKAGE_DIR", "file:///repo/src/store-ops.ts", {}, true],
  ["a .ts module with a blank OMO_PACKAGE_DIR", "file:///repo/src/store-ops.ts", { OMO_PACKAGE_DIR: " " }, true],
  ["a .ts module a launcher started", "file:///repo/src/store-ops.ts", { OMO_PACKAGE_DIR: "/payload" }, false],
  ["a bundled .mjs worker with no OMO_PACKAGE_DIR", "file:///plugin/extensions/gateway-store-worker.mjs", {}, false],
  ["a bundled .js extension with no OMO_PACKAGE_DIR", "file:///plugin/extensions/omo.js", {}, false],
] as const)("#given %s #then isUnlaunchedSourceRun is %p", (_case, url, env, expected) => {
  expect(isUnlaunchedSourceRun(url, env)).toBe(expected)
})

const facts = (passwd: () => string): PlatformFacts => ({
  platform: "linux",
  uid: 1000,
  env: {},
  readFile: passwd,
  isFile: () => false,
  run: () => {
    throw new Error("no tool")
  },
})

test("#given HOME and USERPROFILE elsewhere #when the agent dir is the OS user record's store #then it is shared", () => {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  // A real directory as the record's home: a literal /home/<user> is the macOS auto_home trigger, where Bun's realpath of
  // the missing path's parent never returns and the test file never ends (#14866).
  const recordHome = temp("agent-home-record-")
  // The facts are Linux's, so the record is a passwd line: its home field is a POSIX path. On win32 a temp dir carries a
  // drive ("C:\..."), whose colon would split the line and leave no record at all (#14994); drop the drive there.
  const recordValue = recordHome.replace(/^[A-Za-z]:/, "").replaceAll("\\", "/")
  try {
    process.env.HOME = join("/", "alternate-home")
    delete process.env.USERPROFILE
    const record = facts(() => `me:x:1000:1000::${recordValue}:/bin/sh\n`)
    expect(isSharedAgentDir(join(recordValue, ".omo", "agent"), { facts: record })).toBe(true)
    expect(isSharedAgentDir(join("/", "tmp", "isolated-agent"), { facts: record })).toBe(false)
  } finally {
    rmSync(recordHome, { recursive: true, force: true })
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test.each([
  [
    "the user record cannot be read",
    (): string => {
      throw new Error("no passwd")
    },
  ],
  ["no user record names this uid", (): string => "root:x:0:0::/root:/bin/sh\n"],
] as const)(
  "#given %s #when an isolated agent dir is checked #then it counts as shared (fail closed, #14622 review M4)",
  (_case, passwd) => {
    expect(isSharedAgentDir(join("/", "tmp", "isolated-agent"), { facts: facts(passwd) })).toBe(true)
  },
)
