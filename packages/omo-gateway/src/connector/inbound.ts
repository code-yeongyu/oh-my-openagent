// The connector's inbound stage: realtime and catch-up events enter one serialized queue, an id
// the cursor has seen is dropped, a new one goes to the sink and only then into the cursor, which
// is persisted before the next event is taken.

import type { InboundEvent } from "../adapter/contract"
import type { ConnectorCursor } from "./cursor"
import type { ConnectorSink } from "./sink"

export class InboundPipeline {
  private chain: Promise<void> = Promise.resolve()
  private handedOff = 0

  constructor(
    private readonly cursor: ConnectorCursor,
    private readonly sink: ConnectorSink,
    private readonly scope: string,
    private readonly log: (line: string) => void,
  ) {}

  get emitted(): number {
    return this.handedOff
  }

  /** Queue `event`; resolves when it was dropped as a duplicate or handed off and persisted. */
  accept(event: InboundEvent): Promise<void> {
    const run = this.chain.then(() => this.handle(event))
    this.chain = run.catch(() => undefined)
    return run
  }

  idle(): Promise<void> {
    return this.chain
  }

  private async handle(event: InboundEvent): Promise<void> {
    if (this.cursor.hasSeen(event.event_id)) return
    try {
      await this.sink.emit({ scope: this.scope, event })
    } catch (error) {
      this.log(`sink refused ${event.event_id}, retried at the next catch-up: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.cursor.record(event)
    this.handedOff += 1
    await this.cursor.save()
    this.log(`handed off ${event.event_id}`)
  }
}
