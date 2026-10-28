import { afterEach, beforeEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { hashSessionId } from "../telemetry/product-identity"
import { collectHostSections } from "./collect-host"
import { createFeedbackCore } from "./runtime"

// #11638: consent is read again when the report is sent, and the session-hash salt comes from the env the caller passes.

let root: string
let previousAgentDir: string | undefined
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-feedback-submit-consent-"))
  previousAgentDir = process.env.OMO_CODING_AGENT_DIR
  // process.env names a DIFFERENT agent dir than the injected env, so any read from process.env is visible.
  process.env.OMO_CODING_AGENT_DIR = join(root, "process-agent")
})
afterEach(() => {
  if (previousAgentDir === undefined) delete process.env.OMO_CODING_AGENT_DIR
  else process.env.OMO_CODING_AGENT_DIR = previousAgentDir
  rmSync(root, { recursive: true, force: true })
})

const installId = "b".repeat(64)
const installHash = createHash("sha256").update(installId).digest("hex")
const redact = (text: string) => ({ text, count: 0 })
const session = {
  cwd: "",
  sessionManager: { getSessionId: () => "synthetic-session", getBranch: () => [] },
}

function setup() {
  const env: Record<string, string | undefined> = {
    HOME: root,
    USERPROFILE: root,
    OMO_CODING_AGENT_DIR: join(root, "agent"),
    OMO_NATIVE_INSTALL_ID: installId,
    // A temp HOME counts as an automated run under the native gate (#11421); this run opts in on purpose.
    OMO_TELEMETRY_ALLOW_AUTOMATION: "1",
  }
  const bodies: string[] = []
  const core = createFeedbackCore({
    env,
    omoVersion: "synthetic",
    senpiVersion: "synthetic",
    channel: "test",
    now: () => new Date("2026-10-28T00:00:00.000Z"),
    stateDir: () => join(root, "state"),
    apiOrigin: () => "https://intake.invalid",
    transport: async (_url, init) => {
      bodies.push(String(init.body))
      return new Response(JSON.stringify({ id: "rpt_synthetic" }), { status: 201 })
    },
  })
  const projectDir = join(root, "project")
  mkdirSync(projectDir, { recursive: true })
  return { env, bodies, core, sessionCtx: { ...session, cwd: projectDir } }
}

const writeTelemetrySetting = (enabled: boolean): void => {
  mkdirSync(join(root, ".omo"), { recursive: true })
  writeFileSync(join(root, ".omo", "omo.json"), JSON.stringify({ telemetry: { enabled } }))
}

async function prepareThenSubmit(between: (env: Record<string, string | undefined>) => void) {
  const { env, bodies, core, sessionCtx } = setup()
  const draft = core.prepare(sessionCtx, {}, redact)
  const sessionHash = /session {3}([0-9a-f]{64})/.exec(draft.sections.find((section) => section.id === "identity")?.text ?? "")?.[1]
  between(env)
  const result = await core.submit({ draftId: draft.draftId, kind: "bug", description: "it broke" }, redact)
  return { result, bodies, sessionHash }
}

test("#given consent at prepare #when it stays on until submit #then both hashes are sent (positive control)", async () => {
  const { result, bodies, sessionHash } = await prepareThenSubmit(() => undefined)
  expect(result.kind).toBe("sent")
  expect(sessionHash).toMatch(/^[0-9a-f]{64}$/)
  const body = JSON.parse(bodies[0] ?? "{}")
  expect(body.installHash).toBe(installHash)
  expect(body.sessionHash).toBe(sessionHash)
})

test("#given consent at prepare #when an env opt-out is set before submit #then no hash leaves and the rest of the report is sent", async () => {
  const { result, bodies, sessionHash } = await prepareThenSubmit((env) => {
    env.DO_NOT_TRACK = "1"
  })
  expect(result.kind).toBe("sent")
  expect(bodies).toHaveLength(1)
  const raw = bodies[0] ?? ""
  expect(sessionHash).toMatch(/^[0-9a-f]{64}$/)
  expect(raw).not.toContain(installHash)
  expect(raw).not.toContain(sessionHash ?? "unset")
  const body = JSON.parse(raw)
  expect(body.installHash).toBeUndefined()
  expect(body.sessionHash).toBeUndefined()
  expect(body.sections.map((section: { id: string }) => section.id)).toEqual(expect.arrayContaining(["description", "identity", "environment", "config", "session"]))
  expect(body.sections.find((section: { id: string }) => section.id === "description")?.text).toBe("it broke")
})

test("#given consent at prepare #when telemetry.enabled is turned off on disk before submit #then submit reads the fresh config and no hash leaves", async () => {
  writeTelemetrySetting(true)
  const { result, bodies, sessionHash } = await prepareThenSubmit(() => writeTelemetrySetting(false))
  expect(result.kind).toBe("sent")
  const raw = bodies[0] ?? ""
  expect(sessionHash).toMatch(/^[0-9a-f]{64}$/)
  expect(raw).not.toContain(installHash)
  expect(raw).not.toContain(sessionHash ?? "unset")
})

test("#given an injected env naming its own agent dir #when a session id is hashed #then the salt is read from that dir, not process.env's", () => {
  const injected = { OMO_CODING_AGENT_DIR: join(root, "agent") }
  const saltPath = join(root, "agent", "omo-senpi", "omo-native", "session-id-salt")
  mkdirSync(join(root, "agent", "omo-senpi", "omo-native"), { recursive: true })
  const salt = Buffer.alloc(32, 7)
  writeFileSync(saltPath, salt)

  const hash = hashSessionId("synthetic-session", injected)

  expect(hash).toBe(createHash("sha256").update(salt).update("synthetic-session").digest("hex"))
  expect(existsSync(join(root, "process-agent", "omo-senpi", "omo-native", "session-id-salt"))).toBe(false)
})

test("#given an injected env whose agent dir has no salt yet #when feedback is collected #then the salt is created there, never under process.env's dir", () => {
  const result = collectHostSections({
    env: { HOME: root, USERPROFILE: root, OMO_CODING_AGENT_DIR: join(root, "agent"), OMO_NATIVE_INSTALL_ID: installId, OMO_TELEMETRY_ALLOW_AUTOMATION: "1" },
    omoVersion: "synthetic", senpiVersion: "synthetic", channel: "test",
    now: new Date("2026-10-28T00:00:00.000Z"),
    session: { sessionId: "synthetic-session", entries: [] },
  })
  const saltPath = join(root, "agent", "omo-senpi", "omo-native", "session-id-salt")
  expect(existsSync(saltPath)).toBe(true)
  expect(result.sessionHash).toBe(createHash("sha256").update(readFileSync(saltPath)).update("synthetic-session").digest("hex"))
  expect(existsSync(join(root, "process-agent", "omo-senpi", "omo-native", "session-id-salt"))).toBe(false)
})
