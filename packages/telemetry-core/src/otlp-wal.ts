import { closeSync, mkdirSync, openSync, truncateSync, writeSync } from "node:fs"
import { join } from "node:path"

import { toBinary } from "@bufbuild/protobuf"

import type { LogRecordProcessor, ReadableLogRecord } from "./otel-minimal-logs"
import type { ReadableSpan, SpanProcessor } from "./otel-minimal-trace"
import { isWireAttributeKey } from "./otlp-config"
import { encodeLogRecord, encodeSpan } from "./otlp-encode"
import { LogRecordSchema } from "./otlp-proto/opentelemetry/proto/logs/v1/logs_pb.js"
import { SpanSchema } from "./otlp-proto/opentelemetry/proto/trace/v1/trace_pb.js"
import { activeName, batchName, deleteFile, publishBatch } from "./otlp-spool-dir"
import { frame, type Signal } from "./otlp-spool-file"

export type SpoolWriterInput = {
  readonly dir: string
  readonly signal: Signal
  readonly pid: number
  readonly bootId: string
  readonly header: Uint8Array
  readonly consent: () => boolean
  /** `records`: how many records the failure lost (the failing one, or a whole abandoned file). */
  readonly onError: (error: unknown, records: number) => void
  /** The raw write; returns the bytes written, which may be fewer than given (a short write). */
  readonly write?: (fd: number, bytes: Uint8Array) => number
  readonly truncate?: (fd: number, length: number) => void
}

function defaultWrite(fd: number, bytes: Uint8Array): number {
  return writeSync(fd, bytes)
}

/**
 * This process's ACTIVE spool file for one signal. Every record is appended synchronously (no fsync)
 * BEFORE anything is queued, so a process death loses nothing already emitted. The file and the
 * directory are created on the first consented append only: telemetry that is off leaves no file.
 */
export class SpoolWriter {
  readonly #input: SpoolWriterInput
  readonly name: string
  #fd: number | null = null
  records = 0
  bytes = 0

  constructor(input: SpoolWriterInput) {
    this.#input = input
    this.name = activeName(input.signal, input.pid, input.bootId)
  }

  get signal(): Signal {
    return this.#input.signal
  }

  /** Encoding runs inside the same error boundary as the write: a record that cannot be encoded is reported, never thrown. */
  append(encode: Uint8Array | (() => Uint8Array)): boolean {
    if (!this.#input.consent()) return false
    try {
      const bytes = frame(typeof encode === "function" ? encode() : encode)
      const fd = this.#fd ?? this.#open()
      try {
        this.#writeAll(fd, bytes)
      } catch (error) {
        this.#rollback(fd)
        throw error
      }
      this.records += 1
      this.bytes += bytes.byteLength
      return true
    } catch (error) {
      this.#input.onError(error, 1)
      return false
    }
  }

  /** Loops over short writes until the whole frame is on disk; a write that makes no progress fails. */
  #writeAll(fd: number, bytes: Uint8Array): void {
    const write = this.#input.write ?? defaultWrite
    let at = 0
    while (at < bytes.byteLength) {
      const written = write(fd, bytes.subarray(at))
      if (!(written > 0)) throw new Error("spool write made no progress")
      at += written
    }
  }

  /**
   * A frame that failed part-way is cut off again, so the next frame starts right after the last
   * complete one instead of after torn bytes that would make the whole file read as misframed. If the
   * cut itself fails, the file is abandoned (closed and deleted), every record it held is reported as
   * lost, and the next append starts a new one.
   */
  #rollback(fd: number): void {
    // By path, not by fd: the file is open for append, and on Windows an append-only handle cannot be
    // truncated (ftruncate fails with EPERM), which would abandon the file over one torn frame. Appends
    // land at the new end either way.
    const path = join(this.#input.dir, this.name)
    const truncate = this.#input.truncate ?? ((_fd: number, length: number) => truncateSync(path, length))
    try {
      truncate(fd, this.bytes)
    } catch (error) {
      this.#input.onError(error, this.records)
      this.discard()
    }
  }

  #open(): number {
    const path = join(this.#input.dir, this.name)
    let fd: number
    try {
      fd = openSync(path, "a", 0o600)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      mkdirSync(this.#input.dir, { recursive: true, mode: 0o700 })
      fd = openSync(path, "a", 0o600)
    }
    const header = frame(this.#input.header)
    try {
      this.#writeAll(fd, header)
    } catch (error) {
      closeSync(fd)
      deleteFile(this.#input.dir, this.name)
      throw error
    }
    this.#fd = fd
    this.bytes = header.byteLength
    return fd
  }

  #close(): void {
    if (this.#fd === null) return
    closeSync(this.#fd)
    this.#fd = null
    this.records = 0
    this.bytes = 0
  }

  seal(batchId: string): string | null {
    if (this.#fd === null || this.records === 0) return null
    this.#close()
    const sealed = batchName(this.#input.signal, batchId)
    return publishBatch(this.#input.dir, this.name, sealed) ? sealed : null
  }

  discard(): void {
    const open = this.#fd !== null
    this.#close()
    if (open) deleteFile(this.#input.dir, this.name)
  }

  close(): void {
    this.#close()
  }
}

const EVENT_NAME = /^omo\.[a-z][a-z0-9_]{0,62}$/

function wireAttributes<T>(attributes: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => isWireAttributeKey(key)))
}

export class WalLogRecordProcessor implements LogRecordProcessor {
  readonly writer: SpoolWriter
  readonly #onAppended: (writer: SpoolWriter) => void

  constructor(writer: SpoolWriter, onAppended: (writer: SpoolWriter) => void) {
    this.writer = writer
    this.#onAppended = onAppended
  }

  onEmit(record: ReadableLogRecord): void {
    const encode = (): Uint8Array =>
      toBinary(LogRecordSchema, encodeLogRecord({ ...record, body: undefined, severityText: "", attributes: wireAttributes(record.attributes) }))
    // No free-text slot: a record's name must be an `omo.<bare name>` event, or it is not written.
    if (record.eventName === undefined || !EVENT_NAME.test(record.eventName)) return
    if (this.writer.append(encode)) this.#onAppended(this.writer)
  }

  shutdown(): void {
    this.writer.close()
  }
}

/** Per span name, the attribute keys that span may carry (the schema artifact's span allowlist). */
export type SpanAllowlist = Readonly<Record<string, readonly string[]>>

export class WalSpanProcessor implements SpanProcessor {
  readonly writer: SpoolWriter
  readonly #onAppended: (writer: SpoolWriter) => void
  readonly #spans: SpanAllowlist

  constructor(writer: SpoolWriter, onAppended: (writer: SpoolWriter) => void, spans: SpanAllowlist) {
    this.writer = writer
    this.#onAppended = onAppended
    this.#spans = spans
  }

  onEnd(span: ReadableSpan): void {
    // A span name outside the allowlist is not written; a listed span keeps only its listed attributes.
    const allowed = Object.hasOwn(this.#spans, span.name) ? new Set(this.#spans[span.name]) : undefined
    if (allowed === undefined) return
    const attributes = Object.fromEntries(Object.entries(wireAttributes(span.attributes)).filter(([key]) => allowed.has(key)))
    const encode = (): Uint8Array => toBinary(SpanSchema, encodeSpan({ ...span, attributes }))
    if (this.writer.append(encode)) this.#onAppended(this.writer)
  }

  shutdown(): void {
    this.writer.close()
  }
}
