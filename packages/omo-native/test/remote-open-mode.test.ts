import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { REMOTE_EXIT } from "../remote-cli"
import { owners, privateDir, run, SIGNED_IN, testBootstrap, useRemoteCliCleanup } from "./remote-cli-harness"
import { commandTargets, NEW_KEY, PEER, personWorld } from "./remote-person-world"
import { UsageError } from "../remote-exit"
import { localPermissionPreset } from "../remote-permission-preset"
import { parseSession } from "../remote-session-args"

// #6189: `omo remote open` names the mode the new session runs in - --permission-preset, else this device's own
// engine setting - so the session never falls into the engine's delegated `ask` default with nobody to answer.

const dirs: string[] = []
useRemoteCliCleanup()
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function open(args: readonly string[], localMode: () => string = () => "workspace", world = personWorld()) {
  const owner = await startFakeOwner({ stateDir: privateDir(), world })
  owners.push(owner)
  const result = await run(["open", "studio", ...args], owner.stateDir, SIGNED_IN, testBootstrap(), {
    localPermissionPreset: localMode,
  })
  const frames = owner.state.commands.filter((rpc) => rpc["type"] === "open_session")
  const modes = frames.map((rpc) => rpc["permissionPreset"])
  const types = owner.state.commands.map((rpc) => rpc["type"])
  return { ...result, modes, frames, types, targets: commandTargets(owner.state.bindings) }
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
    expect(JSON.parse(result.out[0] ?? "{}")).toMatchObject({ receipt: { lane: expect.any(String) } })
  })

  test("#given the peer lists the new session by its relay key #when opened with --prompt #then the prompt goes to that key", async () => {
    const result = await open(["--prompt", "build it", "--json"])
    expect(result.code).toBe(REMOTE_EXIT.ok)
    expect(result.targets).toContain(`${PEER}/${NEW_KEY}`)
  })

  test("#given malformed create options #when parsed #then each is a usage error and nothing is opened", async () => {
    for (const args of [["--model", "opus"], ["--thinking", "huge"], ["--branch", "x"], ["--worktree"], ["--steer"]]) {
      const result = await open(args)
      expect(result.code).toBe(REMOTE_EXIT.usage)
      expect(result.frames).toEqual([])
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
