import { batchOf, portErrorOf, type BatchResult, type Settled } from "./outcome.ts"
import type { FleetPort, MachineRef, PortError, WaveContext, WaveOptions, WaveOutcome } from "./ports.ts"

export type MachineOp<Machine, Value> = (machine: Machine, context: WaveContext) => Promise<Value>

/** How a machine is named in an outcome: the row's identity, never the live proxy. */
export type MachineLabel = Pick<MachineRef, "id" | "alias" | "state">

type Resolution<Machine> =
  { readonly kind: "machine"; readonly machine: Machine } | { readonly kind: "rejected"; readonly error: PortError }

// The fleet client's contract is one outcome per dispatched machine; a slot left empty would otherwise
// vanish from the batch, so it is reported instead of dropped.
const NO_OUTCOME: PortError = {
  code: "no_outcome",
  message: "the fleet client settled no outcome for this machine",
  next_action: "report it; check the machine with listMachines() before running the operation again",
}

function labelOf(machine: MachineRef): MachineLabel {
  return { id: machine.id, alias: machine.alias, state: machine.state }
}

function settledOf<Target, Value>(target: Target, outcome: WaveOutcome<unknown, Value>): Settled<Target, Value> {
  switch (outcome.kind) {
    case "fulfilled":
      return { kind: "fulfilled", target, value: outcome.value }
    case "rejected":
      return { kind: "rejected", target, error: portErrorOf(outcome.error) }
    case "skipped":
      return { kind: "skipped", target, reason: outcome.reason ?? "duplicate" }
  }
}

function resolve<Machine extends MachineRef>(rows: readonly Machine[], idOrAlias: string): Resolution<Machine> {
  const matches = rows.filter((row) => row.id === idOrAlias || row.alias === idOrAlias)
  const [machine] = matches
  if (machine === undefined) {
    return {
      kind: "rejected",
      error: {
        code: "not_found",
        message: `no machine of this account has the id or alias ${idOrAlias}`,
        next_action: "use an id or alias from listMachines()",
      },
    }
  }
  if (matches.length > 1) {
    return {
      kind: "rejected",
      error: {
        code: "ambiguous",
        message: `${matches.length} machines share the alias ${idOrAlias}`,
        next_action: "address the machine by its id from listMachines()",
      },
    }
  }
  return { kind: "machine", machine }
}

/** Runs `op` on every machine of the account in one wave; offline and unsupported machines come back skipped. */
export async function onEveryMachine<Machine extends MachineRef, Value>(
  fleet: FleetPort<Machine>,
  op: MachineOp<Machine, Value>,
  options?: WaveOptions,
): Promise<BatchResult<MachineLabel, Value>> {
  const outcomes: { readonly index: number; readonly settled: Settled<MachineLabel, Value> }[] = []
  for await (const outcome of fleet.fanout("all", async (machine, context) => op(machine, context), options)) {
    outcomes.push({ index: outcome.index, settled: settledOf(labelOf(outcome.machine), outcome) })
  }
  return batchOf(outcomes.sort((left, right) => left.index - right.index).map(({ settled }) => settled))
}

/**
 * Runs `op` on the named machines (ids or aliases) in one wave and answers one outcome per name, in input
 * order. A name that matches no machine, or more than one, is rejected without running anything for it.
 */
export async function onMachines<Machine extends MachineRef, Value>(
  fleet: FleetPort<Machine>,
  targets: readonly string[],
  op: MachineOp<Machine, Value>,
  options?: WaveOptions,
): Promise<BatchResult<string, Value>> {
  const slots = new Array<Settled<string, Value> | undefined>(targets.length).fill(undefined)
  const dispatched: { readonly slot: number; readonly machine: Machine }[] = []
  try {
    const rows = await fleet.listMachines()
    targets.forEach((target, slot) => {
      const resolution = resolve(rows, target)
      if (resolution.kind === "rejected") slots[slot] = { kind: "rejected", target, error: resolution.error }
      else dispatched.push({ slot, machine: resolution.machine })
    })
    if (dispatched.length > 0) {
      const wave = fleet.fanout(
        dispatched.map(({ machine }) => machine),
        async (machine, context) => op(machine, context),
        options,
      )
      for await (const outcome of wave) {
        const entry = dispatched[outcome.index]
        if (entry !== undefined) slots[entry.slot] = settledOf(targets[entry.slot] ?? entry.machine.id, outcome)
      }
    }
  } catch (thrown) {
    // The directory read or the wave itself failed: every target still unsettled carries that one cause.
    const error = portErrorOf(thrown)
    targets.forEach((target, slot) => {
      if (slots[slot] === undefined) slots[slot] = { kind: "rejected", target, error }
    })
  }
  return batchOf(targets.map((target, slot) => slots[slot] ?? { kind: "rejected", target, error: NO_OUTCOME }))
}

/** `onMachines` for one machine: one outcome, never a throw. */
export async function onMachine<Machine extends MachineRef, Value>(
  fleet: FleetPort<Machine>,
  idOrAlias: string,
  op: MachineOp<Machine, Value>,
  options?: WaveOptions,
): Promise<Settled<string, Value>> {
  const { outcomes } = await onMachines(fleet, [idOrAlias], op, options)
  return outcomes[0] ?? { kind: "rejected", target: idOrAlias, error: NO_OUTCOME }
}
