import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { endpointKindOf, listRegistryEndpoints } from "./endpoint-registry"

const scratch: string[] = []
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

function agentDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "thr-registry-")))
  scratch.push(dir)
  mkdirSync(join(dir, "rpc-host-daemon"), { recursive: true })
  return dir
}

/** senpi's directory name, computed independently of the reader: sha256 of the canonical socket, 16 hex. */
function dirName(canonicalSocket: string): string {
  return createHash("sha256").update(canonicalSocket, "utf8").digest("hex").slice(0, 16)
}

function writeEndpoint(root: string, name: string, files: Record<string, unknown>): string {
  const dir = join(root, "rpc-host-daemon", name)
  mkdirSync(dir, { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true })
    writeFileSync(join(dir, file), JSON.stringify(content))
  }
  return dir
}

function layout(root: string): void {
  writeFileSync(join(root, "rpc-host-daemon", "layout.json"), JSON.stringify({ layout: 2, dir: "0000000000000000" }))
}

describe("endpoint registry reader (endpoint.json, layout 2)", () => {
  test("#given a tui record, a legacy record without registry_version, a settings-only host and a foreign record #when listed #then kinds, identities and versions follow the on-disk format", async () => {
    // given
    const root = agentDir()
    layout(root)
    mkdirSync(join(root, "rpc", "tui"), { recursive: true })
    mkdirSync(join(root, "rpc", "shards"), { recursive: true })
    const tui = join(root, "rpc", "tui", "t-0123456789abcdef.sock")
    const legacy = join(root, "rpc", "rpc.sock")
    const shard = join(root, "rpc", "shards", "i-00000000000000aa.sock")
    writeEndpoint(root, dirName(tui), { "endpoint.json": { layout: 2, registry_version: 1, endpoint_kind: "tui", socket: tui, created_at: "2026-09-29T00:00:00.000Z" } })
    writeEndpoint(root, dirName(legacy), { "endpoint.json": { layout: 2, socket: legacy, created_at: "2026-09-01T00:00:00.000Z" } })
    writeEndpoint(root, dirName(shard), { "settings.json": { socket: shard } })
    const foreign = writeEndpoint(root, "ffffffffffffffff", { "endpoint.json": { layout: 2, registry_version: 1, endpoint_kind: "tui", socket: tui } })

    // when
    const listed = await listRegistryEndpoints(root)

    // then
    const bySocket = new Map(listed.map((entry) => [entry.socket, entry]))
    expect(bySocket.get(tui)).toMatchObject({ endpoint_kind: "tui", identity: "endpoint", registry_version: 1 })
    expect(bySocket.get(legacy)).toMatchObject({ endpoint_kind: "rpc_host", identity: "endpoint", registry_version: null })
    expect(bySocket.get(shard)).toMatchObject({ endpoint_kind: "rpc_host", identity: "settings" })
    expect(listed.find((entry) => entry.dir === foreign)).toMatchObject({ socket: null, identity: "unknown", endpoint_kind: "rpc_host" })
    expect(listed.map((entry) => entry.dir)).toEqual([...listed.map((entry) => entry.dir)].sort())
  })

  test("#given a record spelled through a symlinked directory #when listed #then its directory is the canonical socket's hash and the record is accepted", async () => {
    // given
    const root = agentDir()
    layout(root)
    const real = join(root, "real-rpc")
    mkdirSync(join(real, "tui"), { recursive: true })
    symlinkSync(real, join(root, "link-rpc"))
    const spelled = join(root, "link-rpc", "tui", "t-fedcba9876543210.sock")
    const canonical = join(real, "tui", "t-fedcba9876543210.sock")
    writeEndpoint(root, dirName(canonical), { "endpoint.json": { layout: 2, registry_version: 1, endpoint_kind: "tui", socket: spelled } })

    // when
    const listed = await listRegistryEndpoints(root)

    // then
    expect(listed).toEqual([expect.objectContaining({ socket: spelled, endpoint_kind: "tui", identity: "endpoint" })])
  })

  test("#given an agent dir without the layout marker #when listed #then there is no registry", async () => {
    const root = agentDir()
    writeEndpoint(root, "0123456789abcdef", { "endpoint.json": { socket: "/x.sock" } })
    expect(await listRegistryEndpoints(root)).toEqual([])
  })

  test("#given a socket #when its kind is asked #then a terminal socket name or a tui record says tui and everything else is a host", async () => {
    const root = agentDir()
    layout(root)
    const recorded = join(root, "rpc", "custom.sock")
    mkdirSync(join(root, "rpc"), { recursive: true })
    writeEndpoint(root, dirName(recorded), { "endpoint.json": { layout: 2, registry_version: 1, endpoint_kind: "tui", socket: recorded } })
    const registry = await listRegistryEndpoints(root)
    expect(endpointKindOf("/anywhere/t-0123456789abcdef.sock", [])).toBe("tui")
    expect(endpointKindOf(recorded, registry)).toBe("tui")
    expect(endpointKindOf(join(root, "rpc", "rpc.sock"), registry)).toBe("rpc_host")
    expect(endpointKindOf("/anywhere/p-0123456789abcdef.sock", registry)).toBe("rpc_host")
  })
})
