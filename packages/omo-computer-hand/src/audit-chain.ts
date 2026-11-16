import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"

/** The first 16 hex digits of SHA-256 (session crate audit/chain.rs). */
function sha256_16(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

/**
 * A line's `lineHash`: SHA-256/16 over its JSON without `prev` and `lineHash`, in the line's own
 * key order (the engine serializes with serde_json's preserve_order).
 */
function lineHash(line: Readonly<Record<string, unknown>>): string {
  const body = Object.fromEntries(Object.entries(line).filter(([key]) => key !== "prev" && key !== "lineHash"))
  return sha256_16(JSON.stringify(body))
}

export interface AnchorState {
  readonly fingerprint: string
  readonly suspended: boolean
  readonly stopEpoch: number
}

export interface WriterIds {
  readonly handId: string
  readonly generation: number
  readonly writerPid: number
  readonly writerProcStartMs: number
}

type Line = Readonly<Record<string, unknown>>

function readLines(path: string): readonly Line[] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((text) => text !== "")
    .map((text): Line => {
      try {
        const value: unknown = JSON.parse(text)
        return typeof value === "object" && value !== null && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value))
          : {}
      } catch (error) {
        if (error instanceof SyntaxError) return {}
        throw error
      }
    })
}

function isAnchor(line: Line): boolean {
  const grant: unknown = line.grant
  return typeof grant === "object" && grant !== null && Reflect.get(grant, "verdict") === "rotation_anchor"
}

/**
 * The newest segment: the lines from the file's last `rotation_anchor` on, with every stamped
 * line's hash recomputed and its `prev` linked to the same writer's previous line (`meta` after
 * that writer's `audit.meta`). `undefined` when there is no anchor or the chain does not hold.
 */
export function newestSegment(path: string): readonly Line[] | undefined {
  const lines = readLines(path)
  const start = lines.findLastIndex(isAnchor)
  if (start === -1) return undefined
  const segment = lines.slice(start)
  const last = new Map<string, string>()
  for (const [index, line] of segment.entries()) {
    const writer = `${String(line.writerPid)}:${String(line.writerProcStartMs)}`
    if (line.kind === "audit.meta") {
      last.set(writer, "meta")
      continue
    }
    if (typeof line.lineHash !== "string" || line.lineHash !== lineHash(line)) return undefined
    const expected = last.get(writer)
    if (index > 0 && expected !== undefined && line.prev !== expected) return undefined
    last.set(writer, line.lineHash)
  }
  return segment
}

function anchorEvent(state: AnchorState): Record<string, unknown> {
  return {
    sessionId: "",
    runId: "",
    callId: "",
    issuer: "",
    scope: "",
    action: "consent.anchor",
    target: "control",
    delivery: "control",
    tier: "read",
    gate: { outcome: "admitted" },
    durationMs: 0,
    grant: {
      kind: "consent_save",
      verdict: "rotation_anchor",
      consent: { fingerprint: state.fingerprint },
      latch: { suspended: state.suspended, stopEpoch: state.stopEpoch },
    },
    status: "success",
  }
}

export function consentSaveEvent(fingerprint: string): Record<string, unknown> {
  return {
    ...anchorEvent({ fingerprint, suspended: false, stopEpoch: 0 }),
    action: "consent.save",
    grant: { kind: "consent_save", verdict: "allow", consent: { fingerprint } },
  }
}

/**
 * The AUTHORITY host's audit writer: its segment opens with `audit.meta` and the
 * `rotation_anchor` (whose `prev` is the file's last `lineHash`); only it rotates the file
 * (`audit.jsonl` -> `audit.1.jsonl`, anchor first in the new file).
 */
export class AuthorityAudit {
  readonly path: string
  readonly #ids: WriterIds
  #seq = 0
  #prev = "meta"
  #open = false

  constructor(path: string, ids: WriterIds) {
    this.path = path
    this.#ids = ids
  }

  get isOpen(): boolean {
    return this.#open
  }

  /** Opens this writer's segment; answers the anchor's `lineHash`. */
  open(state: AnchorState): string {
    const before = readLines(this.path).findLast((line) => typeof line.lineHash === "string")?.lineHash
    this.#seq = 0
    this.#prev = "meta"
    const meta = {
      kind: "audit.meta",
      schema: 2,
      handId: this.#ids.handId,
      generation: this.#ids.generation,
      os: process.platform,
      writerPid: this.#ids.writerPid,
      writerProcStartMs: this.#ids.writerProcStartMs,
    }
    const anchor = this.#stamp(anchorEvent(state))
    const chained = { ...anchor, prev: typeof before === "string" ? before : "meta" }
    this.#write([meta, chained])
    this.#open = true
    return String(anchor.lineHash)
  }

  append(event: Readonly<Record<string, unknown>>): string {
    const line = this.#stamp(event)
    this.#write([line])
    return String(line.lineHash)
  }

  rotate(state: AnchorState): string {
    renameSync(this.path, join(dirname(this.path), "audit.1.jsonl"))
    const before = readLines(join(dirname(this.path), "audit.1.jsonl")).findLast(
      (line) => typeof line.lineHash === "string",
    )?.lineHash
    this.#seq = 0
    this.#prev = "meta"
    const meta = {
      kind: "audit.meta",
      schema: 2,
      handId: this.#ids.handId,
      generation: this.#ids.generation,
      os: process.platform,
      writerPid: this.#ids.writerPid,
      writerProcStartMs: this.#ids.writerProcStartMs,
    }
    const anchor = this.#stamp(anchorEvent(state))
    this.#write([meta, { ...anchor, prev: typeof before === "string" ? before : "meta" }])
    return String(anchor.lineHash)
  }

  #stamp(event: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const line: Record<string, unknown> = {
      v: 2,
      ts: new Date().toISOString(),
      handId: this.#ids.handId,
      generation: this.#ids.generation,
      writerPid: this.#ids.writerPid,
      writerProcStartMs: this.#ids.writerProcStartMs,
      seq: this.#seq + 1,
      ...event,
    }
    const hash = lineHash(line)
    this.#seq += 1
    const stamped = { ...line, prev: this.#prev, lineHash: hash }
    this.#prev = hash
    return stamped
  }

  #write(lines: readonly Readonly<Record<string, unknown>>[]): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    // One append of whole lines: the engine's writers append whole lines too, so no line interleaves.
    appendFileSync(this.path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""), { mode: 0o600 })
  }
}
