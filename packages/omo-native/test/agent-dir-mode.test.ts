import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { agentHomeModeLines } from "../bin/lib/doctor.js"
import { auditOmoHomeModes, canonicalAgentDir, hardenOmoHomeModes, isPublicDirMode } from "../bin/lib/agent-dir.js"

const roots: string[] = []

function createHome(): string {
  const home = mkdtempSync(join(tmpdir(), "omo-home-mode-"))
  roots.push(home)
  return home
}

/** The bits the platform enforces, so a setuid or sticky bit never masquerades as a permission. */
function modeOf(path: string): number {
  return statSync(path).mode & 0o7777
}

function omoDir(home: string, ...segments: string[]): string {
  const path = join(home, ".omo", ...segments)
  mkdirSync(path, { recursive: true })
  return path
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("omo home directory modes", () => {
  describe("#given a legacy 0755 tree under ~/.omo", () => {
    describe("#when the migration runs", () => {
      test("#then every directory in it becomes 0700", () => {
        const home = createHome()
        const agent = omoDir(home, "agent")
        const transcript = omoDir(home, "memory", "agents", "alice", "runtime", "transcripts")
        const omoHome = join(home, ".omo")
        for (const path of [omoHome, agent, transcript]) chmodSync(path, 0o755)

        const result = hardenOmoHomeModes(home)

        expect(result.failed).toEqual([])
        for (const path of [omoHome, agent, transcript]) expect(modeOf(path)).toBe(0o700)
        expect(result.hardened).toContain(transcript)
      })

      test("#then it is idempotent, because a second run finds nothing left to tighten", () => {
        const home = createHome()
        omoDir(home, "agent")
        chmodSync(join(home, ".omo"), 0o755)

        hardenOmoHomeModes(home)
        const second = hardenOmoHomeModes(home)

        expect(second.hardened).toEqual([])
        expect(second.failed).toEqual([])
        expect(modeOf(join(home, ".omo", "agent"))).toBe(0o700)
      })
    })
  })

  describe("#given directories wider than 0755", () => {
    describe("#when the migration runs", () => {
      test("#then 0777 and 0750 are both tightened to 0700", () => {
        const home = createHome()
        const wide = omoDir(home, "wide")
        const groupReadable = omoDir(home, "group-readable")
        chmodSync(wide, 0o777)
        chmodSync(groupReadable, 0o750)

        const result = hardenOmoHomeModes(home)

        expect(result.hardened).toEqual(expect.arrayContaining([wide, groupReadable]))
        expect(modeOf(wide)).toBe(0o700)
        expect(modeOf(groupReadable)).toBe(0o700)
      })

      test("#then a 0701 directory is tightened, because other-execute is exposure too", () => {
        const home = createHome()
        const odd = omoDir(home, "odd")
        chmodSync(odd, 0o701)

        hardenOmoHomeModes(home)

        expect(modeOf(odd)).toBe(0o700)
      })
    })
  })

  describe("#given files inside the tree", () => {
    describe("#when the migration runs", () => {
      test("#then their own modes are left alone, because files are a separate concern", () => {
        const home = createHome()
        const agent = omoDir(home, "agent")
        const settings = join(agent, "settings.json")
        writeFileSync(settings, "{}\n")
        chmodSync(settings, 0o644)
        chmodSync(agent, 0o755)

        hardenOmoHomeModes(home)

        expect(modeOf(settings)).toBe(0o644)
        expect(modeOf(agent)).toBe(0o700)
      })
    })
  })

  describe("#given a symlink inside the tree", () => {
    describe("#when the migration runs", () => {
      test("#then a link out of the tree is neither walked nor chmod'ed", () => {
        const home = createHome()
        const outside = join(createHome(), "elsewhere")
        mkdirSync(outside)
        chmodSync(outside, 0o755)
        const agent = omoDir(home, "agent")
        symlinkSync(outside, join(agent, "link"))
        chmodSync(agent, 0o755)

        hardenOmoHomeModes(home)

        expect(modeOf(outside)).toBe(0o755)
        expect(modeOf(agent)).toBe(0o700)
      })

      test("#then a dangling link is skipped instead of throwing", () => {
        const home = createHome()
        const agent = omoDir(home, "agent")
        symlinkSync(join(home, "does-not-exist"), join(agent, "dangling"))
        chmodSync(agent, 0o755)

        const result = hardenOmoHomeModes(home)

        expect(result.failed).toEqual([])
        expect(result.hardened).toEqual([join(home, ".omo"), agent])
      })
    })
  })

  describe("#given the desktop app's data directories", () => {
    describe("#when the migration runs", () => {
      test("#then desktop/ and desktop.init-* at the top level are left untouched", () => {
        const home = createHome()
        const desktop = omoDir(home, "desktop")
        const init = omoDir(home, "desktop.init-2026")
        chmodSync(desktop, 0o755)
        chmodSync(init, 0o755)

        hardenOmoHomeModes(home)

        expect(modeOf(desktop)).toBe(0o755)
        expect(modeOf(init)).toBe(0o755)
      })

      test("#then a desktop directory nested deeper is left untouched as well", () => {
        const home = createHome()
        const nested = omoDir(home, "agent", "desktop")
        chmodSync(nested, 0o755)

        hardenOmoHomeModes(home)

        expect(modeOf(nested)).toBe(0o755)
      })
    })
  })

  describe("#given no ~/.omo at all", () => {
    describe("#when the migration runs", () => {
      test("#then nothing is created and nothing is reported as failed", () => {
        const home = createHome()

        const result = hardenOmoHomeModes(home)

        expect(result.hardened).toEqual([])
        expect(result.failed).toEqual([])
        expect(readdirSync(home)).toEqual([])
      })
    })
  })

  describe("#given a directory the process cannot read", () => {
    describe("#when the migration runs", () => {
      test("#then the refusal is reported and the walk continues into the sibling, never thrown", () => {
        const home = createHome()
        const unreadable = omoDir(home, "unreadable")
        const sibling = omoDir(home, "sibling")
        chmodSync(unreadable, 0o000)
        chmodSync(sibling, 0o755)

        try {
          const result = hardenOmoHomeModes(home)

          expect(result.failed).toContain(unreadable)
          expect(result.hardened).toContain(sibling)
          expect(modeOf(sibling)).toBe(0o700)
        } finally {
          // Restore access so the fixture can be removed.
          chmodSync(unreadable, 0o700)
        }
      })
    })
  })

  describe("#given a directory the process cannot read", () => {
    describe("#when doctor audits the tree", () => {
      test("#then the unreadable directory is reported and doctor fails", () => {
        const home = createHome()
        const unreadable = omoDir(home, "unreadable")
        chmodSync(unreadable, 0o000)

        try {
          const lines = agentHomeModeLines(auditOmoHomeModes(home))

          expect(lines).toContain(`FAIL omo home modes: could not read ${unreadable}`)
        } finally {
          chmodSync(unreadable, 0o700)
        }
      })
    })
  })

  describe("#given a mode", () => {
    describe("#when it is classified", () => {
      test("#then any group or other bit counts as exposure", () => {
        expect(isPublicDirMode(0o755)).toBe(true)
        expect(isPublicDirMode(0o770)).toBe(true)
        expect(isPublicDirMode(0o707)).toBe(true)
        expect(isPublicDirMode(0o700)).toBe(false)
      })
    })
  })

  describe("#given the canonical agent directory", () => {
    describe("#when the walked root is compared with it", () => {
      test("#then the walk starts one level above the agent directory", () => {
        const home = createHome()
        omoDir(home, "agent")
        expect(hardenOmoHomeModes(home).root).toBe(join(home, ".omo"))
        expect(canonicalAgentDir({}, home)).toBe(join(home, ".omo", "agent"))
      })
    })
  })

  describe("#given a migration result", () => {
    describe("#when doctor audits the same tree", () => {
      test("#then doctor never repairs it, because diagnostics must not mutate the machine", () => {
        const home = createHome()
        const agent = omoDir(home, "agent")
        const omoHome = join(home, ".omo")
        chmodSync(omoHome, 0o755)
        chmodSync(agent, 0o755)

        hardenOmoHomeModes(home)
        const lines = agentHomeModeLines(auditOmoHomeModes(home))

        expect(lines).toEqual(["PASS omo home modes: every directory under ~/.omo is 0700"])
        expect(modeOf(agent)).toBe(0o700)
      })
    })
  })

  describe("#given a tree doctor is asked about", () => {
    describe("#when it is still wider than 0700", () => {
      test("#then each such directory is a FAIL naming the path", () => {
        const home = createHome()
        const agent = omoDir(home, "agent")
        chmodSync(join(home, ".omo"), 0o700)
        chmodSync(agent, 0o755)

        expect(agentHomeModeLines(auditOmoHomeModes(home)))
          .toEqual([`FAIL omo home modes: ${agent} is wider than 0700`])
      })
    })

    describe("#when nothing is wider and nothing is unreadable", () => {
      test("#then it reads as a pass", () => {
        const home = createHome()
        const agent = omoDir(home, "agent")
        chmodSync(join(home, ".omo"), 0o700)
        chmodSync(agent, 0o700)

        expect(agentHomeModeLines(auditOmoHomeModes(home)))
          .toEqual(["PASS omo home modes: every directory under ~/.omo is 0700"])
      })
    })
  })
})