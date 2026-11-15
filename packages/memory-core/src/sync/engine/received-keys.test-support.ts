// Batches from an authenticated member device carrying chosen item keys, for the received-key
// tests (#12147): every batch is signature-valid for the fake verifier, so whatever the receiver
// does with a key is the engine's own decision, never a crypto refusal.

import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

import { ACCOUNT, type Device } from "./engine-harness.test-support"
import { encodePayload } from "./fake-crypto.test-support"
import { type FakeSyncServer, sha256Hex } from "./fake-server.test-support"
import type { BatchPayload } from "./ports"

type Item = BatchPayload["items"][number]

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const execFileAsync = promisify(execFile)

/** A fake-store item that renders as `lines` (no lines: the item renders as deleted). */
export const item = (key: string, ...lines: string[]): Item => ({
  key,
  ops: encoder.encode(
    JSON.stringify({
      adds: Object.fromEntries(lines.map((line, i) => [`${sha256Hex(encoder.encode(key)).slice(0, 12)}-${i}`, line])),
      kills: [],
    }),
  ),
})

export async function publish(server: FakeSyncServer, ...items: Item[]): Promise<number> {
  const transport = server.transport("device:member")
  const batchId = randomBytes(16).toString("base64url")
  const baseSeq = server.head
  const bytes = encodePayload(ACCOUNT, batchId, baseSeq, { items })
  const digest = sha256Hex(bytes)
  const uploadId = await transport.reserve(bytes.length, digest)
  await transport.upload(uploadId, bytes)
  const result = await transport.append({
    uploadId,
    digest,
    baseSeq,
    batchId,
    epoch: 1,
    link: "A".repeat(43),
    recordSig: "S".repeat(86),
  })
  if (!result.ok) throw new Error("the member batch did not append")
  return result.seq
}

interface SealedJson {
  readonly items: readonly { readonly key: string; readonly ops: string }[]
}

export function sealedItems(server: FakeSyncServer, seq: number): SealedJson["items"] {
  const entry = server.entries.find((e) => e.seq === seq)
  const bytes = entry === undefined ? undefined : server.objects.get(entry.objectId)
  if (bytes === undefined) throw new Error(`no object at ${seq}`)
  const sealed: SealedJson = JSON.parse(decoder.decode(bytes))
  return sealed.items
}

/** Re-seals entry `seq` with some item keys renamed (same batch id, base and ops; a new digest). */
export function rekey(server: FakeSyncServer, seq: number, rename: Readonly<Record<string, string>>): void {
  const entry = server.entries.find((e) => e.seq === seq)
  const bytes = entry === undefined ? undefined : server.objects.get(entry.objectId)
  if (bytes === undefined) throw new Error(`no object at ${seq}`)
  const sealed: SealedJson & Record<string, unknown> = JSON.parse(decoder.decode(bytes))
  const items = sealed.items.map((i) => ({ ...i, key: rename[i.key] ?? i.key }))
  server.rewriteEntry(seq, encoder.encode(JSON.stringify({ ...sealed, items })))
}

/** What sits next to the memory root: the device state dir and the root, unless a write escaped. */
export const besideRoot = async (d: Device): Promise<string[]> => (await readdir(dirname(d.repo.root))).sort()

export const gitConfigBytes = (d: Device): Promise<string> => readFile(join(d.repo.gitDir, "config"), "utf8")

export async function gitConfigValue(d: Device, name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", name], {
      cwd: d.repo.root,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    })
    return stdout.trim()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 1) return null
    throw error
  }
}
