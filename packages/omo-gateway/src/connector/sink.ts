// Where the connector hands deduplicated inbound events. Until the session-gateway wiring lands
// (todo 13) the sink is a JSON-lines writer: one `GATEWAY_EVENT <json>` line per event on stdout
// (`--sink stdout`), or `GATEWAY_SHADOW <json>` in shadow mode, which delivers nothing.

import type { InboundEvent, RenderedOp, SendResult, SurfaceAdapter } from "../adapter/contract"

export const EVENT_TAG = "GATEWAY_EVENT"
export const SHADOW_TAG = "GATEWAY_SHADOW"

export type SinkRecord = { scope: string; event: InboundEvent }

export interface ConnectorSink {
  /** resolves once the record is handed off; a rejection leaves the event unrecorded for the next catch-up */
  emit(record: SinkRecord): Promise<void>
}

export type LineWriter = { write(chunk: string, callback: (error?: Error | null) => void): boolean }

export function jsonLinesSink(out: LineWriter, tag: string = EVENT_TAG): ConnectorSink {
  return {
    emit(record) {
      const line = `${tag} ${JSON.stringify(record)}\n`
      return new Promise<void>((resolve, reject) => {
        out.write(line, (error) => (error === null || error === undefined ? resolve() : reject(error)))
      })
    },
  }
}

/** Shadow mode: the adapter still listens and catches up, but every outbound op is logged, never sent. */
export function shadowAdapter(adapter: SurfaceAdapter, log: (line: string) => void): SurfaceAdapter {
  return {
    platform: adapter.platform,
    capabilities: () => adapter.capabilities(),
    listen: (onEvent, signal, ready) => adapter.listen(onEvent, signal, ready),
    catchUp: (since, threads) => adapter.catchUp(since, threads),
    async send(op: RenderedOp): Promise<SendResult> {
      log(`shadow: would send ${op.op}`)
      return { message_id: "", permalink: "", created: null }
    },
  }
}
