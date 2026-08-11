import { mkdirSync } from "node:fs"
import { join } from "node:path"

import type { TelemetryCaptureMessage, TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"
import { writeFileAtomically } from "@oh-my-opencode/utils/atomic-write"

const MAX_PAYLOADS = 50
const MAX_FILE_BYTES = 64 * 1024
const PAYLOAD_FILE_NAME = "last-payloads.json"

export type OmoNativePayloadBuffer = {
  readonly payloads: readonly TelemetryCaptureMessage[]
  readonly onCapture: (payload: TelemetryCaptureMessage) => void
}

export type CreateOmoNativePayloadBufferInput = {
  readonly stateDir: string
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
}

export function getOmoNativePayloadFilePath(stateDir: string): string {
  return join(stateDir, PAYLOAD_FILE_NAME)
}

export function createOmoNativePayloadBuffer(
  input: CreateOmoNativePayloadBufferInput,
): OmoNativePayloadBuffer {
  const payloads: TelemetryCaptureMessage[] = []
  let diagnosticEmitted = false

  const reportOnce = (error: unknown): void => {
    if (diagnosticEmitted) return
    diagnosticEmitted = true
    input.diagnostics?.({
      event: "telemetry_capture_failed",
      source: "omo-native-buffer",
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
  }

  const persist = (): void => {
    try {
      mkdirSync(input.stateDir, { recursive: true })
      writeFileAtomically(getOmoNativePayloadFilePath(input.stateDir), serializeCapped(payloads, reportOnce))
    } catch (error) {
      reportOnce(error)
    }
  }

  return {
    get payloads() {
      return payloads.slice()
    },
    onCapture(payload) {
      payloads.push(payload)
      if (payloads.length > MAX_PAYLOADS) payloads.shift()
      persist()
    },
  }
}

function serializeCapped(
  payloads: readonly TelemetryCaptureMessage[],
  reportOnce: (error: unknown) => void,
): string {
  const retained: string[] = []
  let byteLength = 2

  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    let serialized: string
    try {
      serialized = JSON.stringify(payloads[index])
    } catch (error) {
      reportOnce(error)
      continue
    }
    const separatorBytes = retained.length === 0 ? 0 : 1
    const entryBytes = Buffer.byteLength(serialized, "utf8")
    if (byteLength + separatorBytes + entryBytes > MAX_FILE_BYTES) continue
    retained.unshift(serialized)
    byteLength += separatorBytes + entryBytes
  }

  return `[${retained.join(",")}]`
}
