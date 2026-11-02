import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireClaudeCode, cachedExecutablePath, tarballUrl, type ClaudeCodePin } from "./acquire"

const roots: string[] = []
const temp = () => { const root = mkdtempSync(join(tmpdir(), "omo-claude-code-")); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function packageTarball(files: Record<string, string>): Promise<Uint8Array> {
  return new Bun.Archive(files, { compress: "gzip" }).bytes()
}

function pinFor(bytes: Uint8Array): ClaudeCodePin {
  return {
    name: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    version: "0.3.284",
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    claudeCodeVersion: "2.1.284",
  }
}

function serving(bytes: Uint8Array, requests: string[]): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    requests.push(String(input))
    return new Response(bytes)
  }) as typeof globalThis.fetch
}

describe("acquireClaudeCode", () => {
  test("#given the pinned tarball #when acquired #then the executable is extracted once and a cache hit skips the download", async () => {
    const bytes = await packageTarball({ "package/claude": "#!/bin/sh\necho claude\n", "package/package.json": "{}" })
    const pin = pinFor(bytes)
    const cacheRoot = temp()
    const requests: string[] = []
    const notices: string[] = []
    const first = await acquireClaudeCode({ pin, cacheRoot, platform: "darwin", fetch: serving(bytes, requests), onDownloadStart: (line) => notices.push(line) })
    expect(first).toEqual({ path: cachedExecutablePath(cacheRoot, pin, "darwin"), downloaded: true })
    expect(readFileSync(cachedExecutablePath(cacheRoot, pin, "darwin"), "utf8")).toContain("echo claude")
    expect(requests).toEqual([tarballUrl(pin)])
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("Downloading Claude Code 2.1.284")
    const second = await acquireClaudeCode({ pin, cacheRoot, platform: "darwin", fetch: serving(bytes, requests) })
    expect(second).toEqual({ path: cachedExecutablePath(cacheRoot, pin, "darwin"), downloaded: false })
    expect(requests).toHaveLength(1)
  })

  test("#given bytes that do not match the pinned integrity #when acquired #then nothing is installed", async () => {
    const good = await packageTarball({ "package/claude": "real" })
    const tampered = await packageTarball({ "package/claude": "tampered" })
    const cacheRoot = temp()
    const result = await acquireClaudeCode({ pin: pinFor(good), cacheRoot, platform: "darwin", fetch: serving(tampered, []) })
    expect(result.path).toBeNull()
    expect("error" in result && result.error).toContain("failed its integrity check")
    expect(existsSync(cachedExecutablePath(cacheRoot, pinFor(good), "darwin"))).toBe(false)
  })

  test("#given no network #when acquired #then the error names the offline cause and the alternatives", async () => {
    const bytes = await packageTarball({ "package/claude": "real" })
    const offline = (async () => { throw new TypeError("Unable to connect. Is the computer able to access the url?") }) as unknown as typeof globalThis.fetch
    const result = await acquireClaudeCode({ pin: pinFor(bytes), cacheRoot: temp(), platform: "darwin", fetch: offline })
    expect(result.path).toBeNull()
    const error = "error" in result ? result.error : ""
    expect(error).toContain("Unable to connect")
    expect(error).toContain("CLAUDE_CODE_EXECUTABLE")
  })

  test("#given a Windows host #when acquired #then claude.exe is the extracted entry", async () => {
    const bytes = await packageTarball({ "package/claude.exe": "MZ" })
    const pin = { ...pinFor(bytes), name: "@anthropic-ai/claude-agent-sdk-win32-x64" }
    const result = await acquireClaudeCode({ pin, cacheRoot: temp(), platform: "win32", fetch: serving(bytes, []) })
    expect(result.path?.endsWith("claude.exe")).toBe(true)
  })
})
