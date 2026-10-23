import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../test-support/remove-tree"
import { downloadAndSwapBinary } from "../compiled-update"

// The real swap `omo update` performs (download next to the binary, run its --version, rename over the
// running one), against a local release server. The fake releases are shell scripts, so POSIX only.
const root = mkdtempSync(join(tmpdir(), "omo-update-swap-"))
const releases: Record<string, string> = {
  "/good": "#!/bin/sh\n[ -n \"$BUN_BE_BUN\" ] && { echo 1.4.3; exit 0; }\necho 'omo 9.9.10 (engine: senpi 2026.1.1; scheme nodef)'\n",
  "/wrong-version": "#!/bin/sh\necho 'omo 9.9.8 (engine: senpi 2026.1.1; scheme nodef)'\n",
}
const server = Bun.serve({
  port: 0,
  fetch: (request) => {
    const body = releases[new URL(request.url).pathname]
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body)
  },
})

afterAll(() => {
  server.stop(true)
  removeTree(root)
})

function installed(name: string): string {
  const destination = join(root, name)
  writeFileSync(destination, "old binary", { mode: 0o755 })
  return destination
}

describe.skipIf(process.platform === "win32")("downloadAndSwapBinary", () => {
  test("#given a release that reports the target version, even under an inherited BUN_BE_BUN #then it replaces the binary with an executable copy and leaves no .new file", async () => {
    const destination = installed("omo-good")
    const inherited = process.env.BUN_BE_BUN
    process.env.BUN_BE_BUN = "1"
    try {
      await downloadAndSwapBinary(`${server.url}good`, destination, process.platform, "9.9.10")
    } finally {
      if (inherited === undefined) delete process.env.BUN_BE_BUN
      else process.env.BUN_BE_BUN = inherited
    }
    expect(readFileSync(destination, "utf8")).toBe(releases["/good"])
    expect(statSync(destination).mode & 0o111).not.toBe(0)
    expect(existsSync(`${destination}.new`)).toBe(false)
  })

  for (const [path, why] of [["wrong-version", "reports another version"], ["missing", "is not served"]] as const) {
    test(`#given a release that ${why} #then it throws and the installed binary is untouched`, async () => {
      const destination = installed(`omo-${path}`)
      await expect(downloadAndSwapBinary(`${server.url}${path}`, destination, process.platform, "9.9.10")).rejects.toThrow()
      expect(readFileSync(destination, "utf8")).toBe("old binary")
      expect(existsSync(`${destination}.new`)).toBe(false)
    })
  }
})
