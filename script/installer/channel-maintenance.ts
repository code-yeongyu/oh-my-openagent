#!/usr/bin/env bun
// One-off maintenance for an installer channel pointer (#11313). `head` prints what R2 holds for channels/<channel>:
// the status and every response header of a signed HEAD and GET, plus the GET body. `recreate` deletes the pointer
// and writes it again as a new object, for a key R2 refuses to overwrite. Each request runs once: a failed DELETE
// or create is reported and exits 1, leaving any restore to a person (get.omo.dev falls back to npm meanwhile).
import { parseArgs } from "node:util"
import { isPrerelease, MirrorPlanError, VERSION_PATTERN } from "./mirror-plan"
import { credentialRedactor, deleteObject, putVerified, type R2Credentials, signedRequest } from "./r2-signed-put"

const OPS = ["head", "recreate"] as const
const CHANNELS = ["latest", "beta"] as const

type Op = (typeof OPS)[number]
type Channel = (typeof CHANNELS)[number]

export interface MaintenanceArgs {
  readonly op: Op
  readonly channel: Channel
  readonly version: string | null
}

const isOp = (value: string): value is Op => OPS.some((op) => op === value)
const isChannel = (value: string): value is Channel => CHANNELS.some((channel) => channel === value)

export function parseMaintenanceArgs(argv: readonly string[]): MaintenanceArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: { op: { type: "string" }, channel: { type: "string" }, version: { type: "string" } },
  })
  const op = values.op ?? ""
  const channel = values.channel ?? ""
  if (!isOp(op)) throw new MirrorPlanError(`--op must be ${OPS.join(" or ")}, got ${op}`)
  if (!isChannel(channel)) throw new MirrorPlanError(`--channel must be ${CHANNELS.join(" or ")}, got ${channel}`)
  if (op === "head") return { op, channel, version: null }
  const version = values.version ?? ""
  if (!VERSION_PATTERN.test(version)) throw new MirrorPlanError(`--version must be X.Y.Z[-pre] for recreate, got ${JSON.stringify(version)}`)
  return { op, channel, version }
}

async function describe(credentials: R2Credentials, method: "HEAD" | "GET", key: string, log: (line: string) => void): Promise<Response> {
  const redact = credentialRedactor(credentials)
  const response = await signedRequest(credentials, method, key)
  log(`${method} ${key} -> HTTP ${response.status} ${response.statusText}`)
  for (const [name, value] of response.headers) log(`  ${name}: ${redact(value)}`)
  return response
}

export async function inspectChannel(credentials: R2Credentials, channel: Channel, log: (line: string) => void): Promise<void> {
  const key = `channels/${channel}`
  await describe(credentials, "HEAD", key, log)
  const response = await describe(credentials, "GET", key, log)
  log(`  body: ${JSON.stringify(credentialRedactor(credentials)(await response.text()))}`)
}

export async function recreateChannel(credentials: R2Credentials, channel: Channel, version: string, log: (line: string) => void): Promise<void> {
  const key = `channels/${channel}`
  // publish.yml's rule: a prerelease ships on beta, a stable release on latest.
  const expected: Channel = isPrerelease(version) ? "beta" : "latest"
  if (channel !== expected) throw new MirrorPlanError(`${version} belongs on channels/${expected}, not ${key}`)
  const marker = `releases/v${version}/.complete`
  const mirrored = await signedRequest(credentials, "HEAD", marker)
  if (mirrored.status !== 200) throw new MirrorPlanError(`${marker} -> HTTP ${mirrored.status}; point ${key} only at a fully mirrored version`)
  const before = await signedRequest(credentials, "GET", key)
  log(`${key} before: HTTP ${before.status} ${JSON.stringify(credentialRedactor(credentials)(before.ok ? await before.text() : ""))}`)

  await deleteObject(credentials, key)
  log(`deleted ${key}`)
  const body = `${version}\n`
  const sha256 = new Bun.CryptoHasher("sha256").update(body).digest("hex")
  await putVerified(credentials, key, new Blob([body], { type: "text/plain" }), sha256, { "content-type": "text/plain" })
  log(`created ${key} = ${version}`)

  const after = await signedRequest(credentials, "GET", key)
  const pointer = after.ok ? (await after.text()).trim() : ""
  if (pointer !== version) throw new MirrorPlanError(`${key}: read-back HTTP ${after.status} ${JSON.stringify(pointer)} != ${version}`)
  log(`read back ${key} = ${pointer}`)
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new MirrorPlanError(`${name} is not set`)
  return value
}

if (import.meta.main) {
  const log = (line: string) => console.log(`[channel-maintenance] ${line}`)
  try {
    const args = parseMaintenanceArgs(process.argv.slice(2))
    const credentials: R2Credentials = {
      accountId: required("R2_ACCOUNT_ID"),
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      bucket: process.env.R2_BUCKET ?? "omo-releases",
    }
    if (args.op === "head") await inspectChannel(credentials, args.channel, log)
    else if (args.version !== null) await recreateChannel(credentials, args.channel, args.version, log)
  } catch (error) {
    console.error(`[channel-maintenance] FAILED: ${String(error)}`)
    process.exitCode = 1
  }
}
