import type {
  BunshinClient,
  FanoutOutcome,
  FanoutResult,
  FanoutRun,
  StandaloneMachine,
} from "../../vendor/bunshin-ts/index.js"

import { deviceOperationError } from "./bunshin-ts-errors"

const FLEET = "the fleet"

const isMachine = (value: unknown): value is StandaloneMachine =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "shell") === "function" &&
  typeof Reflect.get(value, "withToken") === "function"

const deviceOf = (machine: StandaloneMachine): string => (machine.alias === "" ? machine.id : machine.alias)

const typedCall =
  (call: (...args: unknown[]) => unknown, operation: string, device: string, requestId?: string) =>
  (...args: unknown[]): unknown => {
    let result: unknown
    try {
      result = call(...args)
    } catch (error) {
      throw deviceOperationError(error, operation, device, requestId)
    }
    if (isMachine(result)) return typedMachine(result)
    if (result instanceof Promise)
      return result.then(
        (value: unknown) => (isMachine(value) ? typedMachine(value) : value),
        (error: unknown) => {
          throw deviceOperationError(error, operation, device, requestId)
        },
      )
    if (typeof result === "function") return typedCall(result as (...a: unknown[]) => unknown, String(args[0]), device)
    return result
  }

/** The same machine, whose every operation rejects with a typed `BunshinSessionError` naming it and the device. */
function typedMachine<Machine extends StandaloneMachine>(machine: Machine): Machine {
  const device = deviceOf(machine)
  return new Proxy(machine, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target)
      if (typeof value !== "function" || typeof property !== "string") return value
      return typedCall((...args) => Reflect.apply(value, target, args), property, device)
    },
  })
}

// The same run, typed: its own failure (target lookup, options, dedup) names the fleet, and a target error the
// runner made (a timeout) names that device. Errors the callback threw (`own`) are the caller's and pass as thrown.
function typedFanoutRun<T>(run: FanoutRun<T>, own: WeakSet<Error>): FanoutRun<T> {
  const runError = (error: unknown): Error => deviceOperationError(error, "fanout", FLEET)
  const targetError = (machine: StandaloneMachine, error: Error): Error =>
    own.has(error) ? error : deviceOperationError(error, "fanout", deviceOf(machine))
  const typedOutcome = (outcome: FanoutOutcome<T>): FanoutOutcome<T> =>
    outcome.kind === "rejected"
      ? { ...outcome, machine: typedMachine(outcome.machine), error: targetError(outcome.machine, outcome.error) }
      : { ...outcome, machine: typedMachine(outcome.machine) }
  const typedResult = ({ fulfilled, rejected, skipped }: FanoutResult<T>): FanoutResult<T> => ({
    fulfilled: fulfilled.map((entry) => ({ ...entry, machine: typedMachine(entry.machine) })),
    rejected: rejected.map(({ machine, error }) => ({
      machine: typedMachine(machine),
      error: targetError(machine, error),
    })),
    ...(skipped === undefined
      ? {}
      : { skipped: skipped.map((entry) => ({ ...entry, machine: typedMachine(entry.machine) })) }),
  })
  // Built on first use, so a run nobody awaits leaves no extra unhandled rejection behind.
  let settled: Promise<FanoutResult<T>> | undefined
  const result = (): Promise<FanoutResult<T>> =>
    (settled ??= run.then(typedResult, (error: unknown) => {
      throw runError(error)
    }))
  const overrides: Readonly<Record<PropertyKey, unknown>> = {
    then: (...args: Parameters<Promise<FanoutResult<T>>["then"]>) => result().then(...args),
    catch: (...args: Parameters<Promise<FanoutResult<T>>["catch"]>) => result().catch(...args),
    finally: (...args: Parameters<Promise<FanoutResult<T>>["finally"]>) => result().finally(...args),
    [Symbol.asyncIterator]: async function* () {
      try {
        for await (const outcome of run) yield typedOutcome(outcome)
      } catch (error) {
        throw runError(error)
      }
    },
  }
  return new Proxy(run, {
    get: (target, property) =>
      Object.hasOwn(overrides, property) ? overrides[property] : Reflect.get(target, property, target),
  })
}

type Target = { readonly device: string; readonly requestId?: string }
const onDevice = ([device]: readonly [string, ...unknown[]]): Target => ({ device })

const callbackFailure = (own: WeakSet<Error>, thrown: unknown): Error => {
  const error = thrown instanceof Error ? thrown : new Error(String(thrown))
  own.add(error)
  return error
}

/** The client with typed failures: machines it hands out (fanout included) and its own calls, connect included. */
export function typedClient(client: BunshinClient): BunshinClient {
  const wrap =
    <Args extends unknown[], Result>(
      operation: string,
      call: (...args: Args) => Promise<Result>,
      target: (args: Args) => Target = () => ({ device: FLEET }),
    ) =>
    (...args: Args): Promise<Result> => {
      const { device, requestId } = target(args)
      return typedCall(call as (...a: unknown[]) => unknown, operation, device, requestId)(...args) as Promise<Result>
    }
  return {
    setPolicy: wrap("setPolicy", client.setPolicy, onDevice),
    getPolicy: wrap("getPolicy", client.getPolicy, onDevice),
    listMachines: () =>
      wrap("listMachines", client.listMachines)().then((machines) => machines.map((machine) => typedMachine(machine))),
    fanout: (targets, fn, options) => {
      const own = new WeakSet<Error>()
      const run = client.fanout(
        targets,
        (machine, context) => {
          try {
            return Promise.resolve(fn(typedMachine(machine), context)).catch((thrown: unknown) => {
              throw callbackFailure(own, thrown)
            })
          } catch (thrown) {
            throw callbackFailure(own, thrown)
          }
        },
        options,
      )
      return typedFanoutRun(run, own)
    },
    getMachine: wrap("getMachine", client.getMachine, onDevice),
    findMachine: wrap("findMachine", client.findMachine),
    listTools: wrap("listTools", client.listTools, onDevice),
    resultOf: wrap("resultOf", client.resultOf, ([requestId]) => ({ device: FLEET, requestId })),
    events: (eventOptions) => client.events(eventOptions),
    close: () => client.close(),
  }
}
