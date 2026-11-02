import { parseArgs } from "node:util"
import { join } from "node:path"
import { z } from "zod"

export const CASES = ["bytes", "graph", "startup", "rpc", "extension", "webfetch", "photon", "changelog", "providers", "skills", "bytes-targets"] as const
export type CaseName = typeof CASES[number]
export const captureSchema = z.object({
  phase: z.enum(["baseline", "post"]), binary: z.string().min(1), out: z.string().min(1),
  case: z.enum(CASES).optional(),
})
export type CaptureOptions = z.infer<typeof captureSchema>
export class AuditError extends Error {
  readonly name = "AuditError"
  constructor(readonly probe: string, readonly detail: string) { super(`${probe}: ${detail}`) }
}
export function parseCaptureArgs(args: readonly string[]): CaptureOptions {
  return captureSchema.parse(parseArgs({ args: [...args], options: {
    phase: { type: "string" }, binary: { type: "string" }, out: { type: "string" }, case: { type: "string" },
  }, strict: true, allowPositionals: false }).values)
}
export function parseModuleCount(output: string): number {
  const match = /\bbundle(?:d)?\s+(\d+)\s+modules\b/i.exec(output)
  const count = Number(match?.[1])
  if (!Number.isInteger(count) || count < 1000) throw new AuditError("graph", `missing engine graph: ${output}`)
  return count
}
export function graphArguments(release: readonly string[], out: string): string[] {
  const args: string[] = []
  for (let index = 0; index < release.length; index++) {
    const value = release[index]
    if (value === undefined) continue
    if (value === "--outfile" || value === "--asset") { index++; continue }
    if (value === "--compile" || /^--(?:no-)?compile-autoload-/.test(value) || /^--(?:asset|outfile)=/.test(value)) continue
    args.push(value.startsWith("--target=bun-") ? "--target=bun" : value)
  }
  return [...args, "--outdir", out, `--metafile=${join(out, "meta.json")}`]
}
export function normalizeReceipt(text: string, paths: readonly (readonly [string, string])[]): string {
  let result = text
  for (const [path, sentinel] of [...paths].sort((a, b) => b[0].length - a[0].length)) result = result.replaceAll(path, sentinel)
  return result.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:PORT")
}
export function classifyFailure(message: string): "auth" | "network" | "module-resolution" | "other" {
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFound|Cannot find package/i.test(message)) return "module-resolution"
  if (/\b40[13]\b|unauthori[sz]ed|unauthenticated|UnrecognizedClientException|InvalidClientTokenId|security token|access denied|invalid.*(?:token|credential)/i.test(message)) return "auth"
  if (/ECONN|ENOTFOUND|network|fetch failed|connection|protocol error|HTTP\/2/i.test(message)) return "network"
  return "other"
}
export const timingsSchema = z.object({
  mean: z.number().positive(), stddev: z.number().nonnegative(),
  times: z.array(z.number().positive()).length(30), exit_codes: z.array(z.literal(0)).length(30),
})
export type Timings = z.infer<typeof timingsSchema>
export function parseTimings(value: unknown): Timings { return timingsSchema.parse(value) }
export function timingGate(baseline: Timings, post: Timings, kind: "version" | "oneshot") {
  const ratio = kind === "version" ? 1.10 : 1.15
  const standardError = Math.sqrt(baseline.stddev ** 2 / baseline.times.length + post.stddev ** 2 / post.times.length)
  const limit = baseline.mean * ratio + 3 * standardError
  return { pass: post.mean <= limit, limit, observed: post.mean, ratio, standardError }
}
export type ArtifactSize = { readonly size: number; readonly target: string }
export function byteGate(post: ArtifactSize, baseline: ArtifactSize | undefined, gate: "p0" | "p1") {
  const limit = post.target === "darwin-arm64"
    ? (gate === "p0" ? 104_857_600 : 94_371_840)
    : Math.min(157_286_400, baseline === undefined ? Infinity : baseline.size * 0.8)
  return { pass: post.size <= limit, observed: post.size, limit }
}
export const providerSchema = z.object({
  mode: z.enum(["classic", "multi"]), api: z.enum(["bedrock-converse-stream", "cursor-agent", "devin-agent"]),
  requestObserved: z.boolean(), stopReason: z.string(), failureClass: z.enum(["auth", "network", "module-resolution", "other"]),
  errorMessage: z.string(),
})
export const wireSchema = z.object({
  type: z.string(), id: z.string().optional(), sessionId: z.string().optional(),
  success: z.boolean().optional(), command: z.string().optional(), data: z.json().optional(),
  error: z.string().optional(), message: z.json().optional(), messages: z.array(z.json()).optional(),
}).passthrough()
export type WireRecord = z.infer<typeof wireSchema>
export const assistantSchema = z.object({
  role: z.literal("assistant"), stopReason: z.string(), errorMessage: z.string().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
}).passthrough()
