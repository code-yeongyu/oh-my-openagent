import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { attestLspDaemonCliProcess, readLspDaemonOwnerTarget } from "./lsp-daemon-family"
import {
  attestLspDaemonOwner,
  createLspDaemonOwnerPingRequest,
  type LspDaemonOwnerIdentity,
} from "./lsp-daemon-owner-attestation"

describe("owner-bound lsp-daemon attestation", () => {
  test("#given unrelated generic daemon argv #when owner ping cannot prove identity #then the process is spared", async () => {
    const owner: LspDaemonOwnerIdentity = {
      endpoint: { dev: 1, ino: 2, kind: "unix", path: "/tmp/daemon.sock" },
      nonce: "owner-nonce",
      pid: 4242,
      startedAt: "2026-07-30T00:00:00.000Z",
    }
    const target = { authPath: "/tmp/auth.token", owner, ownerPath: "/tmp/daemon.owner", pid: owner.pid }
    const genericArgvAttested = await attestLspDaemonCliProcess(owner.pid, "linux", {
      readProcFile: async () => Buffer.from("/usr/bin/node\0/tmp/cli.js\0daemon\0"),
    })
    const ownerAttested = await attestLspDaemonOwner(target, {
      pingOwner: async () => null,
      readText: async (path) => path === target.ownerPath ? JSON.stringify(owner) : "auth-token",
    })

    expect(genericArgvAttested).toBe(true)
    expect(ownerAttested).toBe(false)
  })

  test("#given the unchanged owner and authenticated ping #when attested #then identity is proven", async () => {
    const owner: LspDaemonOwnerIdentity = {
      endpoint: { dev: 1, ino: 2, kind: "unix", path: "/tmp/daemon.sock" },
      nonce: "owner-nonce",
      pid: 4242,
      startedAt: "2026-07-30T00:00:00.000Z",
    }
    const target = { authPath: "/tmp/auth.token", owner, ownerPath: "/tmp/daemon.owner", pid: owner.pid }

    expect(await attestLspDaemonOwner(target, {
      pingOwner: async () => owner,
      readText: async (path) => path === target.ownerPath ? JSON.stringify(owner) : "auth-token",
    })).toBe(true)
  })
  test("#given an owner auth token #when a ping request is created #then it matches the daemon wire protocol", () => {
    expect(createLspDaemonOwnerPingRequest("auth-token")).toEqual({
      id: "process-sweep-owner-attestation",
      jsonrpc: "2.0",
      method: "omo/ping",
      params: { _omo: { protocolVersion: 1, token: "auth-token" } },
    })
  })

  test("#given a version directory #when the owner target is read #then it points at the daemon auth token file", async () => {
    const versionDir = mkdtempSync(join(tmpdir(), "omo-lsp-owner-target-"))
    const owner = {
      endpoint: { dev: 1, ino: 2, kind: "unix", path: join(versionDir, "daemon.sock") },
      nonce: "owner-nonce",
      pid: 4242,
      startedAt: "2026-07-30T00:00:00.000Z",
    }
    writeFileSync(join(versionDir, "daemon.owner"), JSON.stringify(owner))

    expect(readLspDaemonOwnerTarget(versionDir)).toEqual({
      authPath: join(versionDir, "daemon.auth"),
      owner,
      ownerPath: join(versionDir, "daemon.owner"),
      pid: owner.pid,
    })
    rmSync(versionDir, { force: true, recursive: true })
  })

  test("#given the real daemon request router #when the owner ping request is authenticated #then the owner is returned", async () => {
    const routerPath = join(import.meta.dir, "..", "..", "..", "lsp-daemon", "src", "request-routing.ts")
    const { handleDaemonMessage } = (await import(routerPath)) as {
      readonly handleDaemonMessage: (raw: unknown, state: Record<string, unknown>) => Promise<unknown>
    }
    const owner = {
      endpoint: { kind: "missing" as const, path: "memory" },
      nonce: "router-nonce",
      pid: 4242,
      startedAt: "2026-07-30T00:00:00.000Z",
    }

    const response = await handleDaemonMessage(createLspDaemonOwnerPingRequest("router-token"), {
      owner,
      token: "router-token",
    })

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "process-sweep-owner-attestation",
      result: { protocolVersion: 1, ...owner },
    })
  })

})
