import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { attachDoriterm, type DoritermPorts } from "./doriterm-attach"
import { remoteCommand, type RemoteProgram } from "./ssh-port"

const LINK = "https://app.doriterm.example/join#secret-join-fixture-7f3a"
const meshLine = (members: number) =>
  `doriterm-setup: mesh ok mesh 1a2b3c4d sync=on ${members} members: a=self b=connected`
const OK = "doriterm-setup: result ok"

type Remote = { lines: readonly string[]; code: number }

function fakes(options: {
  members?: number
  prerequisites?: readonly string[]
  install?: Remote
  inviteWrites?: boolean
  join?: Remote
  afterJoin?: number
}) {
  const calls: string[] = []
  const stdins: string[] = []
  const dirs: string[] = []
  let joined = false
  const ports: DoritermPorts = {
    local: async (args) => {
      calls.push(`local:${args[0]}`)
      if (args[0] === "verify") {
        if (options.members === undefined)
          return { code: 0, lines: ["doriterm-setup: mesh ok this host is in no mesh yet", OK] }
        const count = joined ? (options.afterJoin ?? options.members + 1) : options.members
        return { code: 0, lines: [meshLine(count), OK] }
      }
      if (args[0] === "invite") {
        const out = args[2]
        if (out !== undefined && options.inviteWrites !== false) writeFileSync(out, `${LINK}\n`, { mode: 0o600 })
        return { code: options.inviteWrites === false ? 1 : 0, lines: [options.inviteWrites === false ? "x" : OK] }
      }
      return { code: 2, lines: [] }
    },
    remote: async (program: RemoteProgram, stdin?: string) => {
      calls.push(`remote:${program.kind}`)
      if (stdin !== undefined) stdins.push(stdin)
      if (program.kind === "doriterm_prerequisites")
        return { lines: options.prerequisites ?? ["git:present", "1.4.4"], exit: { code: 0 } }
      if (program.kind === "doriterm_install") {
        const result = options.install ?? { lines: [OK], code: 0 }
        return { lines: result.lines, exit: { code: result.code } }
      }
      if (program.kind === "doriterm_join") {
        const result = options.join ?? { lines: [OK], code: 0 }
        joined = result.code === 0
        return { lines: result.lines, exit: { code: result.code } }
      }
      throw new Error(`unexpected ${program.kind}`)
    },
    tempDir: async () => {
      const dir = mkdtempSync(join(tmpdir(), "omo-doriterm-test-"))
      dirs.push(dir)
      return dir
    },
    sleep: async () => undefined,
  }
  return { ports, calls, stdins, dirs }
}

describe("attachDoriterm", () => {
  test("#given no mesh on the caller #when attached #then skipped and no doriterm command reaches the target", async () => {
    const f = fakes({})
    expect(await attachDoriterm(f.ports)).toEqual({ kind: "skipped", reason: "caller_has_no_mesh" })
    expect(f.calls.filter((call) => call.startsWith("remote:"))).toEqual([])
  })

  test("#given a mesh on the caller #when attached #then install, invite, join and verify run in that order", async () => {
    const f = fakes({ members: 2 })
    expect(await attachDoriterm(f.ports)).toEqual({ kind: "attached", members: 3 })
    expect(f.calls).toEqual([
      "local:verify",
      "remote:doriterm_prerequisites",
      "remote:doriterm_install",
      "local:invite",
      "remote:doriterm_join",
      "local:verify",
    ])
    expect(f.stdins).toEqual([LINK])
  })

  test("#given a target without a recent bun #when attached #then skipped with the missing prerequisite and no invite", async () => {
    const f = fakes({ members: 2, prerequisites: ["git:present", "1.2.0"] })
    expect(await attachDoriterm(f.ports)).toEqual({
      kind: "skipped",
      reason: "target_prerequisite_missing",
      missing: "bun",
    })
    expect(f.calls).not.toContain("local:invite")
  })

  test("#given a failed install on the target #when attached #then install_failed and no invite was made", async () => {
    const f = fakes({ members: 2, install: { lines: [], code: 1 } })
    expect(await attachDoriterm(f.ports)).toMatchObject({ kind: "failed", code: "install_failed" })
    expect(f.calls).not.toContain("local:invite")
  })

  test("#given a failing join #when attached #then join_failed and the temp dir is gone", async () => {
    const f = fakes({ members: 2, join: { lines: ["doriterm-setup: join fail x"], code: 1 } })
    expect(await attachDoriterm(f.ports)).toMatchObject({ kind: "failed", code: "join_failed" })
    expect(f.dirs.map((dir) => existsSync(dir))).toEqual([false])
  })

  test("#given a member count that never rises #when verified #then verify_failed after the retries", async () => {
    const f = fakes({ members: 2, afterJoin: 2 })
    expect(await attachDoriterm(f.ports)).toMatchObject({ kind: "failed", code: "verify_failed" })
  })

  test("#given any outcome #when its value, the calls and the commands are scanned #then the join link appears only on stdin", async () => {
    const outcomes = [
      await attachDoriterm(fakes({ members: 2 }).ports),
      await attachDoriterm(fakes({ members: 2, join: { lines: [`join fail ${LINK}`], code: 1 } }).ports),
    ]
    const commands = (["doriterm_prerequisites", "doriterm_install", "doriterm_join"] as const).map((kind) =>
      remoteCommand({ kind }),
    )
    expect(JSON.stringify({ outcomes, commands })).not.toContain("secret-join-fixture")
  })

  test("#given the join command #when built #then it writes the link under umask 077 and removes it in an exit trap", () => {
    const command = remoteCommand({ kind: "doriterm_join" })
    expect(command.indexOf("umask 077")).toBeLessThan(command.indexOf('cat > "$f"'))
    expect(command.indexOf("trap 'rm -f \"$f\"' EXIT")).toBeLessThan(command.indexOf('cat > "$f"'))
  })
})
