import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eligibleUpdateLaunch, updateFlag, updatePolicy } from "../update-policy"
import { updateProbeEnvironment } from "../compiled-update-download"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

test("prefix precedence preserves explicitly empty values and truthy zero", () => {
  expect(updateFlag("OFFLINE", { OMO_OFFLINE: "", SENPI_OFFLINE: "1" })).toBe(false)
  expect(updateFlag("OFFLINE", { OMO_OFFLINE: "0", SENPI_OFFLINE: "" })).toBe(true)
  expect(updateFlag("OFFLINE", { SENPI_OFFLINE: "", PI_OFFLINE: "1" })).toBe(false)
  expect(updateFlag("OFFLINE", { PI_OFFLINE: "1" })).toBe(true)
})

test("only user settings authorize automation; invalid settings disable it", async () => {
  const home = await mkdtemp(join(tmpdir(), "update-policy-"))
  roots.push(home)
  const env = { HOME: home }
  expect(await updatePolicy(env)).toEqual({ mode: "auto" })
  await mkdir(join(home, ".omo", "updates"), { recursive: true })
  const file = join(home, ".omo", "updates", "settings.json")
  for (const mode of ["auto", "notify", "off"] as const) {
    await writeFile(file, JSON.stringify({ mode }))
    expect((await updatePolicy(env)).mode).toBe(mode)
    expect((await updatePolicy({ ...env, OMO_AUTO_UPDATE: "off" })).mode).toBe("off")
  }
  for (const value of ["{", "null", "[]", '{"mode":"yes"}', "{}"]) {
    await writeFile(file, value)
    expect((await updatePolicy(env)).mode).toBe("off")
    expect((await updatePolicy(env)).reason).toBeDefined()
  }
})

for (const flag of ["OFFLINE", "SKIP_VERSION_CHECK"]) {
  for (const prefix of ["OMO", "SENPI", "PI"]) {
    test(`${prefix}_${flag} suppresses even a staged automatic activation`, async () => {
      expect((await updatePolicy({ OMO_AUTO_UPDATE: "auto", [`${prefix}_${flag}`]: "1" })).mode).toBe("off")
    })
  }
}

test("static, machine and internal modes never trigger automatic lifecycle", () => {
  for (const args of [
    ["--version"], ["-v"], ["--help"], ["-h"], ["update"], ["doctor"], ["setup"], ["host", "ensure"],
    ["daemon", "run"], ["thread", "send"], ["--mode", "rpc"], ["--mode", "json"],
    ["-p", "message"], ["--print", "message"], ["--no-extensions"], ["--json"],
    ["--omo-update-worker", "/launcher", "id"],
    ["--internal-rpc-host-supervisor"],
  ]) expect(eligibleUpdateLaunch(args, {}, true)).toBe(false)
  expect(eligibleUpdateLaunch([], {}, false)).toBe(false)
  expect(eligibleUpdateLaunch([], {}, true, true)).toBe(false)
  for (const env of [{ CI: "1" }, { OMO_PROVISIONED_HANDOFF: "/runtime" }, { SENPI_TASK_ID: "child" }]) {
    expect(eligibleUpdateLaunch([], env, true)).toBe(false)
  }
  expect(eligibleUpdateLaunch([], {}, true)).toBe(true)
  expect(eligibleUpdateLaunch(["--", "--mode"], {}, true)).toBe(true)
})

test("candidate probes inherit trust but no credentials or recursive dispatch markers", () => {
  const env = updateProbeEnvironment("/isolated", {
    PATH: "/bin", OMO_EXTRA_CA_CERTIFICATES: "/ca.pem", OPENAI_API_KEY: "secret",
    BUN_BE_BUN: "1", OMO_UPDATE_HANDOFF: "old", OMO_UPDATE_WORKER: "1", OMO_PROVISIONED_HANDOFF: "/old",
    OMO_CODING_AGENT_DIR: "/real", SENPI_CODING_AGENT_DIR: "/real", SENPI_BRAND: "{}",
  })
  expect(env.OPENAI_API_KEY).toBeUndefined()
  expect(env.BUN_BE_BUN).toBeUndefined()
  expect(env.OMO_UPDATE_HANDOFF).toBeUndefined()
  expect(env.OMO_PROVISIONED_HANDOFF).toBeUndefined()
  expect(env.SENPI_BRAND).toBeUndefined()
  expect(env.OMO_EXTRA_CA_CERTIFICATES).toBe("/ca.pem")
  expect(env.OMO_CODING_AGENT_DIR).toBe(join("/isolated", "agent"))
  expect(env.OMO_OFFLINE).toBe("1")
})
