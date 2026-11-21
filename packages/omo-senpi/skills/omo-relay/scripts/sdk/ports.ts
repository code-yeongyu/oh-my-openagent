// The narrow shapes the helpers need from the shipped fleet client and from the thread tools. The helpers
// depend on these ports, never on the shipped bundles (which carry no type declarations), so a change in
// how the product exposes machines or threads moves `bind-eval.ts` only.

/** The part of a machine row every helper reads. */
export type MachineRef = {
  readonly id: string
  readonly alias: string
  readonly state: "online" | "offline"
}

/** Handed to every machine callback; aborts when the wave's `timeoutMs` passes for that machine. */
export type WaveContext = { readonly signal: AbortSignal }

/** One machine's outcome as the fleet client yields it while a wave runs; `index` is its place in the wave. */
export type WaveOutcome<Machine, Value> =
  | { readonly kind: "fulfilled"; readonly machine: Machine; readonly value: Value; readonly index: number }
  | { readonly kind: "rejected"; readonly machine: Machine; readonly error: Error; readonly index: number }
  | { readonly kind: "skipped"; readonly machine: Machine; readonly reason?: string; readonly index: number }

export type WaveOptions = {
  readonly concurrency?: number
  readonly timeoutMs?: number
}

export type FleetPort<Machine extends MachineRef> = {
  listMachines(): Promise<readonly Machine[]>
  fanout<Value>(
    targets: readonly Machine[] | "all",
    fn: (machine: Machine, context: WaveContext) => Promise<Value>,
    options?: WaveOptions,
  ): AsyncIterable<WaveOutcome<Machine, Value>>
}

/** A failure in the shape every thread tool and every fleet error carries. */
export type PortError = {
  readonly code: string
  readonly message: string
  readonly next_action: string
  readonly uncertain?: boolean
}

export type PortOk<Value> = { readonly kind: "ok" } & Value

export type PortAnswer<Value> = PortOk<Value> | { readonly kind: "error"; readonly error: PortError }

/** The part of a `thread_list` row the helpers read; `thread` is the value every thread tool takes back. */
export type ThreadRow = {
  readonly thread: string
  readonly name: string
  readonly machine?: string
}

export type ThreadListOptions = {
  readonly all_scope?: boolean
  readonly state?: readonly ("running" | "idle" | "inactive" | "archived")[]
}

export type ThreadReadOptions = {
  readonly wait_ms?: number
  readonly max_bytes?: number
  readonly all_scope?: boolean
}

export type ThreadSendOptions = {
  readonly delivery?: "auto" | "steer" | "follow_up"
  readonly all_scope?: boolean
}

export type ThreadListValue = { readonly threads: readonly ThreadRow[] }
export type ThreadReadValue = { readonly thread: string; readonly items: readonly unknown[] }
export type ThreadSendValue = { readonly thread: string }

export type ThreadPort = {
  list(options?: ThreadListOptions): Promise<PortAnswer<ThreadListValue>>
  read(thread: string, options?: ThreadReadOptions): Promise<PortAnswer<ThreadReadValue>>
  send(thread: string, message: string, options?: ThreadSendOptions): Promise<PortAnswer<ThreadSendValue>>
}
