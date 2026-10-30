import { mock } from "bun:test"
import * as nodeModule from "node:module"
import { z } from "zod"

// One process probes every target (the downloader reads process.platform/arch per call) instead of six cold starts.
const targets = z.array(z.object({
  platform: z.string(),
  arch: z.string(),
})).parse(JSON.parse(process.argv[2] ?? "[]"))

let resolutionAttempts = 0
mock.module("module", () => ({
  ...nodeModule,
  createRequire: () => {
    resolutionAttempts += 1
    throw new Error("npm resolution is unavailable in this fixture")
  },
}))

let urls: string[] = []
const fetchMock = mock(async (input: string | URL | Request) => {
  urls.push(input instanceof Request ? input.url : String(input))
  return new Response(null, { status: 503 })
})
const originalFetch = globalThis.fetch
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
const originalArch = Object.getOwnPropertyDescriptor(process, "arch")
Object.assign(globalThis, { fetch: fetchMock })
try {
  const { downloadCommentChecker } = await import("../downloader")
  const results = []
  for (const { platform, arch } of targets) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true })
    Object.defineProperty(process, "arch", { value: arch, configurable: true })
    urls = []
    const attemptsBefore = resolutionAttempts
    const result = await downloadCommentChecker()
    results.push({ platform, arch, urls, resolutionAttempts: resolutionAttempts - attemptsBefore, result })
  }
  console.log(JSON.stringify(results))
} finally {
  Object.assign(globalThis, { fetch: originalFetch })
  if (originalPlatform !== undefined) Object.defineProperty(process, "platform", originalPlatform)
  if (originalArch !== undefined) Object.defineProperty(process, "arch", originalArch)
  mock.restore()
}
