import { createHash } from "node:crypto"
import { chmodSync, lstatSync, mkdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { MAX_SHARD_BIND_PATH, SHARD_ROOT_ENV, altRoot, resolveShardSocket, validateBindPath, type AltRootFs } from "./shard-socket"
import { LEGACY_OVERRIDES, LONG_ROOT, OWNER_KEY, freshAgentDir, removeFreshAgentDirs, rootIdentity } from "./shard-socket.test-support"

afterEach(removeFreshAgentDirs)

function currentUid(): number {
  return process.getuid?.() ?? -1
}

const actualFs: AltRootFs = { mkdirSync, lstatSync, realpathSync, getuid: currentUid }

// senpi `daemonDirectoryName` on POSIX: the endpoint directory is keyed by the socket string.
function daemonDirectoryName(socket: string): string {
  return createHash("sha256").update(socket, "utf8").digest("hex").slice(0, 16)
}

// The alternate root exists for the unix `sun_path` bind limit and is guarded by POSIX owner and mode
// bits; the rpc-host-sharding plan scopes shard routing to POSIX ("Per-parent shard routing as the ONLY
// task-child routing on POSIX"; Must NOT: "No win32 behavior change ... `RpcHostRunner` still unused
// there"), and win32 never selects the host runner (`engine-runners.ts`, `host-execution-mode.ts`).
describe.skipIf(process.platform === "win32")("the POSIX alternate shard root", () => {
  describe("altRoot", () => {
    test("#given any agent dir #when deriving the alternate root #then it is the fixed /tmp prefix, never os.tmpdir()", () => {
      // given
      const previous = process.env["TMPDIR"]
      process.env["TMPDIR"] = `/var/folders/xx/${"a".repeat(30)}/T`
      try {
        // when
        const root = altRoot("/h/.omo/agent")

        // then
        expect(root).toMatch(/^\/tmp\/omo-rpc-[0-9a-f]{8}$/)
        expect(root).toBe(join("/tmp", `omo-rpc-${createHash("sha256").update("/h/.omo/agent").digest("hex").slice(0, 8)}`))
        expect(root.startsWith(tmpdir())).toBe(false)
      } finally {
        if (previous === undefined) delete process.env["TMPDIR"]
        else process.env["TMPDIR"] = previous
      }
    })
  })

  describe("resolveShardSocket", () => {
    test("#given a fresh alternate root #when resolving #then it is created as a private directory and accepted", () => {
      const agentDir = freshAgentDir()

      const resolution = resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity() })

      expect(resolution.root).toBe("alt")
      expect(statSync(dirname(resolution.socket)).mode & 0o777).toBe(0o700)
    })

    test("#given a pre-existing alternate root with broad permissions #when resolving #then it throws shard_alt_root_unsafe", () => {
      const agentDir = freshAgentDir()
      const root = altRoot(agentDir)
      mkdirSync(root, { recursive: true, mode: 0o700 })
      chmodSync(root, 0o755)

      expect(() => resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity() })).toThrow(
        "shard_alt_root_unsafe",
      )
    })

    test("#given a symlink at the alternate root path #when resolving #then it throws shard_alt_root_unsafe", () => {
      const agentDir = freshAgentDir()
      const root = altRoot(agentDir)
      symlinkSync(agentDir, root)

      expect(() => resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity() })).toThrow(
        "shard_alt_root_unsafe",
      )
    })

    for (const shape of ["file", "dangling symlink"] as const) {
      test(`#given a ${shape} at the alternate root path #when resolving #then it throws shard_alt_root_unsafe`, () => {
        const agentDir = freshAgentDir()
        const root = altRoot(agentDir)
        if (shape === "file") writeFileSync(root, "occupied")
        else symlinkSync(join(agentDir, "absent"), root)

        expect(() => resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity() })).toThrow(
          "shard_alt_root_unsafe",
        )
      })
    }

    test("#given an owned 0700 symlink at the alternate root path #when resolving #then the shape alone refuses it with shard_alt_root_unsafe", () => {
      // given: owner and mode pass the other guards, only the symlink shape is wrong
      const agentDir = freshAgentDir()
      const root = altRoot(agentDir)
      const target = join(agentDir, "target")
      mkdirSync(target, { mode: 0o700 })
      symlinkSync(target, root)
      const fs: AltRootFs = {
        ...actualFs,
        lstatSync(path) {
          const stat = actualFs.lstatSync(path)
          // lchmod is not portable (Linux symlinks are always 0777): report the link itself as 0700, keeping its type bits.
          if (path === root) Object.defineProperty(stat, "mode", { value: (stat.mode & ~0o777) | 0o700 })
          return stat
        },
      }
      const stat = fs.lstatSync(root)
      expect(stat.isSymbolicLink()).toBe(true)
      expect(stat.uid).toBe(currentUid())
      expect(stat.mode & 0o777).toBe(0o700)

      // when / then
      expect(() => resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity(), fs })).toThrow(
        "shard_alt_root_unsafe",
      )
    })

    test("#given an owned 0600 regular file at the alternate root path #when resolving #then the shape alone refuses it with shard_alt_root_unsafe", () => {
      // given: owner and mode pass the other guards, only the non-directory shape is wrong
      const agentDir = freshAgentDir()
      const root = altRoot(agentDir)
      writeFileSync(root, "occupied", { mode: 0o600 })
      const stat = lstatSync(root)
      expect(stat.isFile()).toBe(true)
      expect(stat.uid).toBe(currentUid())
      expect(stat.mode & 0o777).toBe(0o600)

      // when / then
      expect(() => resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity() })).toThrow(
        "shard_alt_root_unsafe",
      )
    })

    test("#given the created alternate root is replaced by a symlink before validation #when resolving #then it refuses the replacement", () => {
      const agentDir = freshAgentDir()
      const root = altRoot(agentDir)
      const fs: AltRootFs = {
        ...actualFs,
        lstatSync(path) {
          const stat = actualFs.lstatSync(path)
          if (path === root) {
            rmSync(root, { recursive: true })
            symlinkSync(agentDir, root)
          }
          return stat
        },
      }

      expect(() => resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity(), fs })).toThrow(
        "shard_alt_root_unsafe",
      )
    })

    test("#given an alternate root owned by another uid through the injected port #when resolving #then it throws shard_alt_root_unsafe", () => {
      const agentDir = freshAgentDir()
      const fs: AltRootFs = {
        ...actualFs,
        lstatSync(path) {
          const stat = actualFs.lstatSync(path)
          Object.defineProperty(stat, "uid", { value: actualFs.getuid() + 1 })
          return stat
        },
      }

      expect(() => resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity(), fs })).toThrow(
        "shard_alt_root_unsafe",
      )
    })

    test("#given a 120-byte root #when resolving #then the same basename lands under the alternate root with a notice and its siblings fit", () => {
      // given
      const agentDir = freshAgentDir()

      // when
      const resolution = resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity() })

      // then
      expect(Buffer.byteLength(LONG_ROOT)).toBe(120)
      expect(resolution.root).toBe("alt")
      expect(resolution.notice).toBe("shard_alt_root")
      expect(resolution.shard).toEqual(rootIdentity())
      expect(basename(resolution.socket)).toBe(`p-${OWNER_KEY}.sock`)
      expect(dirname(resolution.socket)).toBe(realpathSync(altRoot(agentDir)))
      expect(validateBindPath(resolution.socket)).toBe(true)
      expect(Buffer.byteLength(`${resolution.socket}.next-99`)).toBeLessThanOrEqual(MAX_SHARD_BIND_PATH)
      expect(Buffer.byteLength(`${resolution.socket}.shield-9999999`)).toBeLessThanOrEqual(MAX_SHARD_BIND_PATH)
      expect(statSync(dirname(resolution.socket)).mode & 0o777).toBe(0o700)
    })

    test.if(process.platform === "darwin")(
      "#given darwin #when resolving under the alternate root #then it goes through /private/tmp and both spellings name one endpoint dir",
      () => {
        // given
        const agentDir = freshAgentDir()
        const alt = altRoot(agentDir)

        // when
        const resolution = resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity() })

        // then
        const name = basename(resolution.socket)
        expect(resolution.socket.startsWith("/private/tmp/omo-rpc-")).toBe(true)
        const viaTmp = join(realpathSync(alt), name)
        const viaPrivate = join(realpathSync(alt.replace(/^\/tmp\//, "/private/tmp/")), name)
        expect(daemonDirectoryName(viaTmp)).toBe(daemonDirectoryName(resolution.socket))
        expect(daemonDirectoryName(viaPrivate)).toBe(daemonDirectoryName(resolution.socket))
      },
    )

    test("#given the legacy socket overrides in env #when resolving under the alternate root #then the result is unchanged", () => {
      // given
      const agentDir = freshAgentDir()

      // when / then
      const alt = resolveShardSocket({ agentDir, env: { [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity() })
      expect(alt.root).toBe("alt")
      expect(resolveShardSocket({ agentDir, env: { ...LEGACY_OVERRIDES, [SHARD_ROOT_ENV]: LONG_ROOT }, identity: rootIdentity() })).toEqual(alt)
    })
  })
})
