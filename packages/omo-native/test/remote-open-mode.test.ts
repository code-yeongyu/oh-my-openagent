import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { REMOTE_EXIT, runRemoteVerb } from "../remote-cli"
import { UsageError } from "../remote-exit"
import { localPermissionPreset } from "../remote-permission-preset"
import { parseSession } from "../remote-session-args"

// #6189: `omo remote open` names the mode the new session runs in - --permission-preset, else this device's own
// engine setting - so the session never falls into the engine's delegated `ask` default with nobody to answer.

const SIGNED_IN = {
  exitCode: 0,
  stdout: JSON.stringify({ signedIn: true, device: { id: "dev-self", name: "This Mac" }, refreshState: "ok" }),
}
const fixture = createRemoteThreadFixture()
const dirs: string[] = []
const owners: FakeOwner[] = []
afterEach(async () => {
  fixture.cleanup()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function open(
  args: readonly string[],
  localMode: () => string = () => "workspace",
  accountOptions: Parameters<typeof fixture.account>[0] = {},
) {
  const a = fixture.account(accountOptions)
  const out: string[] = []
  const stateDir = mkdtempSync(join(tmpdir(), "omo-6189-owner-"))
  chmodSync(stateDir, 0o700)
  dirs.push(stateDir)
  const owner = await startFakeOwner({ stateDir, world: defaultWorld() })
  owners.push(owner)
  const err: string[] = []
  const code = await runRemoteVerb(
    {
      accountShow: async () => SIGNED_IN,
      stateDir: owner.stateDir,
      connect: () => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir }),
      now: () => 0,
      output: (line) => out.push(line),
      write: () => {},
      error: (line) => err.push(line),
      bootstrap: {
        pinVersion: "1.4.0",
        install: async () => ({ ok: false, state: "service_degraded", action: "none" }),
        refresher: { binaryPath: "/x", version: "0" },
        agentDir: "/x",
      },
      coldWake: {
        install: async () => ({ kind: "installed", serviceRestarted: false }),
        uninstall: async () => ({ kind: "removed", serviceRestarted: false }),
        status: async () => undefined,
      },
      linkDevice: async () => "linked",
      optOut: { read: () => false, record: () => {}, clear: () => {} },
      remote: () => a.remote,
      localPermissionPreset: localMode,
    },
    ["open", "b", ...args],
  )
  const modes = a.sent
    .filter((entry) => entry.rpc?.["type"] === "open_session")
    .map((entry) => entry.rpc?.["permissionPreset"])
  const frames = a.sent.filter((entry) => entry.rpc?.["type"] === "open_session").map((entry) => entry.rpc)
  const types = a.sent.map((entry) => entry.rpc?.["type"])
  return { code, err, out, modes, frames, types, sent: a.sent }
}

// omo#13409 / omo#13410 / omo#13399: `omo remote open` names the model, the thinking level, a new worktree and the first
// prompt in the one open, through the same create path as thread_create.
describe("omo remote open with create options", () => {
  test("#given --thinking #when opened #then the open_session frame carries the level", async () => {
    const result = await open(["--thinking", "high"])
    expect(result.code).toBe(REMOTE_EXIT.ok)
    expect(result.frames).toEqual([expect.objectContaining({ thinkingLevel: "high" })])
  })

  test("#given --prompt #when opened #then the new session is prompted once and the result names the delivery", async () => {
    const result = await open(["--prompt", "build it", "--json"])
    expect(result.code).toBe(REMOTE_EXIT.ok)
    expect(result.types.filter((type) => type === "prompt")).toHaveLength(1)
    expect(JSON.parse(result.out[0] ?? "{}")).toMatchObject({
      kind: "ok",
      thread: "dur-new-on-b",
      prompt: { delivery: expect.any(Object) },
    })
  })

  test("#given b knows the new session only by its relay key #when opened with --prompt #then the prompt goes to that key", async () => {
    const result = await open(["--prompt", "build it", "--json"], undefined, {
      relayKeys: new Map([["dur-new-on-b", "relay-key-9"]]),
      relayKeyOnly: true,
    })
    expect(result.code).toBe(REMOTE_EXIT.ok)
    expect(result.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toEqual([
      expect.objectContaining({ session: "relay-key-9" }),
    ])
  })

  test("#given malformed create options #when parsed #then each is a usage error and nothing is opened", async () => {
    for (const args of [["--model", "opus"], ["--thinking", "huge"], ["--branch", "x"], ["--worktree"], ["--steer"]]) {
      const result = await open(args)
      expect(result.code).toBe(REMOTE_EXIT.usage)
      expect(result.sent).toEqual([])
    }
  })
})

describe("omo remote open --worktree parsing", () => {
  test("#given --worktree with a branch and base #when parsed #then the open names the worktree request", () => {
    expect(
      parseSession("open", ["b", "--project", "/repo", "--worktree", "--branch", "feat/x", "--base", "main"]).session,
    ).toMatchObject({ verb: "open", project: "/repo", worktree: { branch: "feat/x", base: "main" } })
    expect(parseSession("open", ["b", "--project", "/repo", "--worktree"]).session).toMatchObject({ worktree: {} })
  })
})

describe("omo remote open and the approval mode", () => {
  test("#given no flag #when a session is opened #then it names this device's own mode", async () => {
    expect(await open([])).toMatchObject({ code: REMOTE_EXIT.ok, modes: ["workspace"] })
  })

  test("#given --permission-preset ask #when a session is opened #then it names ask", async () => {
    expect(await open(["--permission-preset", "ask"])).toMatchObject({ code: REMOTE_EXIT.ok, modes: ["ask"] })
  })

  test("#given this device's setting cannot be read #when no flag is given #then the command is a usage error and nothing is opened", async () => {
    const result = await open([], () => {
      throw new UsageError("omo remote open: unreadable setting")
    })
    expect(result.modes).toEqual([])
    expect(result.code).toBe(REMOTE_EXIT.usage)
  })

  test("#given an unknown mode #when the command is parsed #then it is a usage error and nothing is opened", async () => {
    const result = await open(["--permission-preset", "full-acess"])
    expect(result.modes).toEqual([])
    expect(result.code).toBe(REMOTE_EXIT.usage)
  })
})

describe("localPermissionPreset", () => {
  const agentDir = (files: Readonly<Record<string, string>>): string => {
    const dir = mkdtempSync(join(tmpdir(), "omo-6189-"))
    dirs.push(dir)
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    return dir
  }

  test("#given settings.jsonc beside settings.json #when read #then the jsonc mode wins, as the engine reads it", () => {
    expect(
      localPermissionPreset(
        agentDir({
          "settings.jsonc": '{ // mine\n "permissionPreset": "read-only" }',
          "settings.json": '{"permissionPreset":"ask"}',
        }),
      ),
    ).toBe("read-only")
  })

  test("#given no settings or no mode in them #when read #then the engine default full-access", () => {
    expect(localPermissionPreset(agentDir({}))).toBe("full-access")
    expect(localPermissionPreset(agentDir({ "settings.json": '{"theme":"dark"}' }))).toBe("full-access")
  })

  // Review of 12839 (LOW): a setting that cannot be read never falls back to the loosest mode.
  test("#given settings naming an unknown mode or not parsing #when read #then it is a usage error, never full-access", () => {
    expect(() => localPermissionPreset(agentDir({ "settings.json": '{"permissionPreset":"everything"}' }))).toThrow(
      UsageError,
    )
    expect(() => localPermissionPreset(agentDir({ "settings.json": '{"permissionPreset": ' }))).toThrow(UsageError)
  })
})
