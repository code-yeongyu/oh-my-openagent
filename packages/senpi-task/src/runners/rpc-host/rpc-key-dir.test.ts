import { describe, expect, test } from "bun:test"
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ensureRpcKeyDirectory } from "./rpc-key-dir"
import { authenticateRpcHost } from "./socket-auth"

const modeOf = (path: string): number => lstatSync(path).mode & 0o7777

function agentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-12194-"))
  chmodSync(root, 0o700)
  return root
}

describe.skipIf(process.platform === "win32")("ensureRpcKeyDirectory (#12194)", () => {
  test("#given no rpc dir under umask 0002 #when ensuring #then it is created 0700", () => {
    // given
    const root = agentDir()
    const previous = process.umask(0o002)
    try {
      // when
      ensureRpcKeyDirectory(root)
      // then
      expect(modeOf(join(root, "rpc"))).toBe(0o700)
    } finally {
      process.umask(previous)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a 0775 rpc dir left by an ambient-umask creator #when ensuring #then only the refused write bits are cleared", () => {
    // given
    const root = agentDir()
    try {
      mkdirSync(join(root, "rpc"))
      chmodSync(join(root, "rpc"), 0o775)
      // when
      ensureRpcKeyDirectory(root)
      // then: 0755 is the state the key-record check itself serves (see host-request-auth.test.ts)
      expect(modeOf(join(root, "rpc"))).toBe(0o755)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given an already-safe rpc dir #when ensuring #then its mode is untouched", () => {
    // given
    const root = agentDir()
    try {
      for (const mode of [0o700, 0o755] as const) {
        mkdirSync(join(root, "rpc"))
        chmodSync(join(root, "rpc"), mode)
        // when
        ensureRpcKeyDirectory(root)
        // then
        expect(modeOf(join(root, "rpc"))).toBe(mode)
        rmSync(join(root, "rpc"), { recursive: true, force: true })
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given rpc is a symlink #when ensuring #then the target is left alone and nothing throws", () => {
    // given
    const root = agentDir()
    try {
      const target = join(root, "elsewhere")
      mkdirSync(target)
      chmodSync(target, 0o775)
      symlinkSync(target, join(root, "rpc"))
      // when
      expect(() => ensureRpcKeyDirectory(root)).not.toThrow()
      // then
      expect(modeOf(target)).toBe(0o775)
      expect(lstatSync(join(root, "rpc")).isSymbolicLink()).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a 0775 rpc dir #when the client authenticates after the heal #then the key-record check passes (#12194 end to end)", async () => {
    // given: the reported failure, verbatim — a 0775 rpc/ under umask 0002
    const root = agentDir()
    try {
      mkdirSync(join(root, "rpc"))
      chmodSync(join(root, "rpc"), 0o775)
      const challenge = {
        data: {
          auth: {
            launch_id: "11111111-1111-4111-8111-111111111111",
            server_nonce: "ab".repeat(32),
            server_proof: "cd".repeat(32),
          },
        },
      }
      const request = async () => challenge
      await expect(authenticateRpcHost(request as never, "rpc.sock", root)).rejects.toThrow("unsafe_key_record")
      // when
      ensureRpcKeyDirectory(root)
      // then: no key record exists, so the grace path returns the reply instead of refusing
      await expect(authenticateRpcHost(request as never, "rpc.sock", root)).resolves.toMatchObject(challenge)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
