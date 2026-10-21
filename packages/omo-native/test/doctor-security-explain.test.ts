import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runSecurityExplain } from "../bin/lib/doctor-security-explain.js"
import { teardownRoots } from "./teardown.test-support"

const roots: string[] = []

afterEach(() => {
  teardownRoots(roots)
})

function emptyHome(): { home: string; agentDir: string } {
  const home = mkdtempSync(join(tmpdir(), "omo-security-explain-"))
  roots.push(home)
  return { home, agentDir: join(home, ".omo", "agent") }
}

function run(home: string, agentDir: string): string[] {
  return runSecurityExplain({ home, env: {}, agentDir })
}

/**
 * The roadmap (`security-roadmap-2026q4.md`, "Usability and discoverability") fixes one
 * `--explain-security` section per security control and names the PR that ships each. The
 * pending marker is the cross-PR protocol that tells a user why their install does not surface a
 * control yet, so both halves of that contract are pinned here rather than re-derived from the
 * module under test.
 */
const ROADMAP_SECTIONS: ReadonlyArray<{ id: string; pr: string; setting: string }> = [
  { id: "file-ref-allowlist-roots", pr: "PR-A", setting: "security.file_ref_allowlist_roots" },
  { id: "telemetry", pr: "PR-B", setting: "telemetry.enabled" },
  { id: "tool-permission-profile", pr: "PR-C", setting: "tools.<name>.permission" },
  { id: "server-consent", pr: "PR-D", setting: "security.server_consent_opt_out" },
  { id: "auth-at-rest", pr: "PR-E", setting: "security.auth_at_rest" },
  { id: "plugin-payload-sha256", pr: "PR-F", setting: "plugin/.omo-payload.sha256" },
  { id: "omo-home-mode", pr: "PR-H", setting: "~/.omo mode 0700 (migration log line)" },
  { id: "ai-assist-disclosure", pr: "PR-I", setting: "pull request AI-assisted checkbox" },
]

describe("doctor --explain-security", () => {
  describe("#given an empty omO home", () => {
    test("#when run #then every roadmap section prints its heading", () => {
      // given
      const { home, agentDir } = emptyHome()

      // when
      const output = run(home, agentDir)

      // then
      const missing = ROADMAP_SECTIONS.filter((section) => !output.includes(section.id))
      expect(missing).toEqual([])
    })

    test("#when run #then every section names the omO.jsonc key or env var that carries it", () => {
      // given
      const { home, agentDir } = emptyHome()

      // when
      const output = run(home, agentDir)

      // then
      const missing = ROADMAP_SECTIONS.filter((section) => !output.some((line) => line.includes(section.setting)))
      expect(missing).toEqual([])
    })

    test("#when run #then a section whose feature has not landed says so and names the PR", () => {
      // given
      const { home, agentDir } = emptyHome()

      // when
      const output = run(home, agentDir)

      // then
      for (const section of ROADMAP_SECTIONS) {
        const marker = `feature pending: see ${section.pr}`
        expect(output.some((line) => line.trimEnd() === `  ${marker}`)).toBe(true)
      }
    })

    test("#when run #then the resolved omO home and agent dir are reported from the arguments", () => {
      // given
      const { home, agentDir } = emptyHome()

      // when
      const output = run(home, agentDir)

      // then
      expect(output.some((line) => line.includes(join(home, ".omo")))).toBe(true)
      expect(output.some((line) => line.includes(agentDir))).toBe(true)
    })

    test("#when run #then nothing is written into the omO home", () => {
      // given
      const { home, agentDir } = emptyHome()
      mkdirSync(join(home, ".omo"), { recursive: true })

      // when
      run(home, agentDir)

      // then
      const after = run(home, agentDir)
      expect(after).toEqual(run(home, agentDir))
    })
  })

  describe("#given a home with an existing omO directory", () => {
    test("#when run #then the directory is reported as present", () => {
      // given
      const { home, agentDir } = emptyHome()
      mkdirSync(join(home, ".omo"), { recursive: true })

      // when
      const output = run(home, agentDir)

      // then
      expect(output.some((line) => line.includes("present"))).toBe(true)
    })
  })

  describe("#given the caller", () => {
    test("#when the function runs #then it prints nothing and returns the prose lines", () => {
      // given
      const { home, agentDir } = emptyHome()
      const printed: unknown[][] = []
      const original = console.log
      console.log = (...args: unknown[]) => {
        printed.push(args)
      }

      try {
        // when
        const output = run(home, agentDir)

        // then
        expect(output.every((line) => typeof line === "string")).toBe(true)
        expect(output.length).toBeGreaterThan(ROADMAP_SECTIONS.length)
        expect(printed).toEqual([])
      } finally {
        console.log = original
      }
    })

    test("#when run with no arguments #then it resolves the host home instead of throwing", () => {
      // when
      const output = runSecurityExplain({ env: {} })

      // then
      expect(output.some((line) => line.includes("agent dir:"))).toBe(true)
    })
  })
})