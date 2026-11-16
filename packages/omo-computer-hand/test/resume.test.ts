import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { classifyOrigin, handResume, LatchStore, readHostLatch, type OriginFacts } from "../src/index.ts"
import { tempDirs } from "./support/tmp.ts"

const temp = tempDirs("omo-hand-resume-")

const consoleFacts: OriginFacts = {
  readable: true,
  ancestors: [
    { pid: 900, name: "zsh" },
    { pid: 800, name: "Terminal" },
  ],
  env: {},
  brainPids: new Set([1234]),
  remoteLaunched: false,
}

function latchedHand() {
  const root = temp()
  const latchFile = join(root, "computer", "host-latch")
  const stopMarker = join(root, "global-stop")
  const latch = new LatchStore(latchFile)
  latch.set({ suspended: true, stopEpoch: 5 })
  writeFileSync(stopMarker, "stopped")
  return { latch, latchFile, stopMarker }
}

describe("hand.resume origin classifier", () => {
  it("classifies only a console origin as attended", () => {
    expect(classifyOrigin(consoleFacts)).toBe("console")
    expect(
      classifyOrigin({
        ...consoleFacts,
        ancestors: [
          { pid: 2, name: "bash" },
          { pid: 1, name: "sshd" },
        ],
      }),
    ).toBe("sshd_pty")
    expect(classifyOrigin({ ...consoleFacts, env: { SSH_CONNECTION: "10.0.0.2 51000 10.0.0.1 22" } })).toBe("sshd_pty")
    expect(
      classifyOrigin({
        ...consoleFacts,
        ancestors: [
          { pid: 3, name: "bash" },
          { pid: 1234, name: "omo" },
        ],
      }),
    ).toBe("agent_child")
    expect(classifyOrigin({ ...consoleFacts, remoteLaunched: true })).toBe("remote_launched")
    expect(classifyOrigin({ ...consoleFacts, readable: false })).toBe("unreadable")
  })
})

describe("hand.resume (the one lift verb)", () => {
  it("resume_from_sshd_pty_refused_origin_unattended", async () => {
    // Given a latched hand and a resume requested from a pty under sshd.
    const hand = latchedHand()
    const audit: unknown[] = []
    let engineResumes = 0

    // When the host is asked to resume.
    const outcome = await handResume({
      origin: "sshd_pty",
      peer: "ui",
      latch: hand.latch,
      stopMarker: hand.stopMarker,
      engine: { resume: async () => void (engineResumes += 1) },
      audit: (line) => void audit.push(line),
    })

    // Then it is refused ControlRequired{origin_unattended}: the latch, its file and the marker are untouched.
    expect(outcome).toEqual({
      kind: "refused",
      code: "ControlRequired",
      reason: "origin_unattended",
      origin: "sshd_pty",
    })
    expect(engineResumes).toBe(0)
    expect(hand.latch.get().suspended).toBe(true)
    expect(JSON.parse(readFileSync(hand.latchFile, "utf8"))).toEqual({ suspended: true, stopEpoch: 5 })
    expect(existsSync(hand.stopMarker)).toBe(true)
    expect(audit).toEqual([
      {
        kind: "grant",
        grant: { kind: "lift", verdict: "deny" },
        peer: "ui",
        origin: "sshd_pty",
        reason: "origin_unattended",
      },
    ])
  })

  it("resume_from_console_clears_host_latch_and_marker_audited", async () => {
    // Given a latched hand, a live engine, and a console origin.
    const hand = latchedHand()
    const audit: unknown[] = []
    const latchAtEngineResume: unknown[] = []

    // When the host resumes.
    const outcome = await handResume({
      origin: "console",
      peer: "ui",
      latch: hand.latch,
      stopMarker: hand.stopMarker,
      engine: {
        resume: async () => {
          latchAtEngineResume.push(readHostLatch(hand.latchFile))
        },
      },
      audit: (line) => void audit.push(line),
    })

    // Then the host latch (memory and file) was clear BEFORE the engine lifted its marker, and the lift is audited.
    expect(outcome).toEqual({ kind: "resumed", origin: "console" })
    expect(latchAtEngineResume).toEqual([{ kind: "read", latch: { suspended: false, stopEpoch: 5 } }])
    expect(hand.latch.get()).toEqual({ suspended: false, stopEpoch: 5 })
    expect(audit).toEqual([{ kind: "grant", grant: { kind: "lift", verdict: "allow" }, peer: "ui", origin: "console" }])
  })

  it("resume_with_no_live_host_clears_marker_only", async () => {
    // Given a stopped hand whose host is not running: only the marker and the persisted latch file exist.
    const hand = latchedHand()

    // When --resume runs from the console with no live host.
    const outcome = await handResume({
      origin: "console",
      peer: "cli",
      stopMarker: hand.stopMarker,
      audit: () => undefined,
    })

    // Then the marker is gone and the persisted host latch is untouched (a host restart lifts nothing).
    expect(outcome).toEqual({ kind: "resumed", origin: "console" })
    expect(existsSync(hand.stopMarker)).toBe(false)
    expect(JSON.parse(readFileSync(hand.latchFile, "utf8"))).toEqual({ suspended: true, stopEpoch: 5 })
  })
})
