import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { provisionSgBinary, SgProvisionError } from "./sg-provisioner"

function tempDir(name: string): string {
  return join(tmpdir(), `omo-${name}-${crypto.randomUUID()}`)
}

function uint16(value: number): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value)
  return buffer
}

function fixtureZip(entryName: string, bytes: Buffer): Buffer {
  const name = Buffer.from(entryName)
  const localHeader = Buffer.concat([
    uint32(0x04034b50),
    uint16(20),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(0),
    uint32(bytes.length),
    uint32(bytes.length),
    uint16(name.length),
    uint16(0),
    name,
  ])
  const centralHeader = Buffer.concat([
    uint32(0x02014b50),
    uint16(20),
    uint16(20),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(0),
    uint32(bytes.length),
    uint32(bytes.length),
    uint16(name.length),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(0),
    uint32(0),
    name,
  ])
  const centralOffset = localHeader.length + bytes.length
  const eocd = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(1),
    uint16(1),
    uint32(centralHeader.length),
    uint32(centralOffset),
    uint16(0),
  ])
  return Buffer.concat([localHeader, bytes, centralHeader, eocd])
}

function responseFor(bytes: Buffer): Response {
  return new Response(bytes)
}

describe("provisionSgBinary", () => {
  it("downloads a verified archive, extracts standalone ast-grep, and writes sg", async () => {
    // given
    const targetDir = tempDir("sg-provision")
    const binary = Buffer.from("#!/bin/sh\nprintf 'ast-grep 0.43.0\\n'\n")
    const archive = fixtureZip("release/ast-grep", binary)
    const archiveSha = createHash("sha256").update(archive).digest("hex")

    // when
    const result = await provisionSgBinary({
      arch: "x64",
      fetchImpl: async () => responseFor(archive),
      platform: "linux",
      releaseAssets: {
        "linux-x64": { sha256: archiveSha, url: "memory://ast-grep.zip" },
      },
      targetDir,
    })

    // then
    expect(result).toBe(join(targetDir, "sg"))
    expect(readFileSync(result)).toEqual(binary)

    rmSync(targetDir, { force: true, recursive: true })
  })

  it("throws an actionable error when the network request fails", async () => {
    // given
    const targetDir = tempDir("sg-network-failure")

    // when
    const attempt = provisionSgBinary({
      fetchImpl: async () => {
        throw new Error("offline")
      },
      platform: "linux",
      targetDir,
    })

    // then
    const error = await attempt.catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(SgProvisionError)
    expect(error).toHaveProperty("message", expect.stringContaining("failed to download ast-grep"))
    expect(existsSync(join(targetDir, "sg"))).toBe(false)

    rmSync(targetDir, { force: true, recursive: true })
  })

  it("rejects a bad sha256 and leaves no binary behind", async () => {
    // given
    const targetDir = tempDir("sg-bad-sha")
    const archive = Buffer.from("not the pinned release archive")
    const archiveSha = createHash("sha256").update(archive).digest("hex")

    // when
    const attempt = provisionSgBinary({
      fetchImpl: async () => responseFor(archive),
      platform: "linux",
      targetDir,
    })

    // then
    await expect(attempt).rejects.toThrow(`got ${archiveSha}`)
    expect(existsSync(join(targetDir, "sg"))).toBe(false)

    rmSync(targetDir, { force: true, recursive: true })
  })

  it("keeps all temporary and final writes inside targetDir", async () => {
    // given
    const root = tempDir("sg-contained")
    const targetDir = join(root, "target")
    const binary = Buffer.from("standalone ast-grep")
    const archive = fixtureZip("ast-grep.exe", binary)

    // when
    const result = await provisionSgBinary({
      arch: "x64",
      fetchImpl: async () => responseFor(archive),
      platform: "win32",
      releaseAssets: {
        "win32-x64": {
          sha256: createHash("sha256").update(archive).digest("hex"),
          url: "memory://ast-grep-windows.zip",
        },
      },
      targetDir,
    })

    // then
    expect(result).toBe(join(targetDir, "sg.exe"))
    expect(existsSync(join(root, "sg.exe"))).toBe(false)
    expect(readFileSync(result)).toEqual(binary)

    rmSync(root, { force: true, recursive: true })
  })
})
