import { mock } from "bun:test"
import * as nodeModule from "node:module"
import { z } from "zod"

const target = z.object({
  platform: z.string(),
  arch: z.string(),
}).parse(JSON.parse(process.argv[2] ?? "{}"))

let resolutionAttempts = 0
mock.module("module", () => ({
  ...nodeModule,
  createRequire: () => {
    resolutionAttempts += 1
    throw new Error("npm resolution is unavailable in this fixture")
  },
}))

const urls: string[] = []
const fetchMock = mock(async (input: string | URL | Request) => {
  urls.push(input instanceof Request ? input.url : String(input))
  return new Response(null, { status: 503 })
})
const originalFetch = globalThis.fetch
Object.assign(globalThis, { fetch: fetchMock })
try {
  // Load the downloader against the real host platform first. Overwriting
  // process.platform/arch before import makes Windows resolve linux-arm64
  // optional natives and blows the 10s probe budget (CI exit 143 / SIGTERM).
  const { downloadCommentChecker } = await import("../downloader")
  Object.defineProperty(process, "platform", { value: target.platform })
  Object.defineProperty(process, "arch", { value: target.arch })
  const result = await downloadCommentChecker()
  console.log(JSON.stringify({ urls, resolutionAttempts, result }))
} finally {
  Object.assign(globalThis, { fetch: originalFetch })
  mock.restore()
}
