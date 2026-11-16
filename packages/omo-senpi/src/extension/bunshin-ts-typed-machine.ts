import type { BunshinClient, StandaloneMachine } from "../../vendor/bunshin-ts/index.js"

import { deviceOperationError } from "./bunshin-ts-errors"

const isMachine = (value: unknown): value is StandaloneMachine =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "shell") === "function" &&
  typeof Reflect.get(value, "withToken") === "function"

const typedCall =
  (call: (...args: unknown[]) => unknown, operation: string, device: string) =>
  (...args: unknown[]): unknown => {
    let result: unknown
    try {
      result = call(...args)
    } catch (error) {
      throw deviceOperationError(error, operation, device)
    }
    if (isMachine(result)) return typedMachine(result)
    if (result instanceof Promise)
      return result.then(
        (value: unknown) => (isMachine(value) ? typedMachine(value) : value),
        (error: unknown) => {
          throw deviceOperationError(error, operation, device)
        },
      )
    if (typeof result === "function") return typedCall(result as (...a: unknown[]) => unknown, String(args[0]), device)
    return result
  }

/** The same machine, whose every operation rejects with a typed `BunshinSessionError` naming it and the device. */
function typedMachine<Machine extends StandaloneMachine>(machine: Machine): Machine {
  const device = machine.alias === "" ? machine.id : machine.alias
  return new Proxy(machine, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target)
      if (typeof value !== "function" || typeof property !== "string") return value
      return typedCall((...args) => Reflect.apply(value, target, args), property, device)
    },
  })
}

const targetOf = (args: readonly unknown[]): string => (typeof args[0] === "string" ? args[0] : "the fleet")

/** The client with typed failures: machines it hands out (fanout included) and its own calls, connect included. */
export function typedClient(client: BunshinClient): BunshinClient {
  const wrap =
    <Args extends unknown[], Result>(operation: string, call: (...args: Args) => Promise<Result>) =>
    (...args: Args): Promise<Result> =>
      typedCall(call as (...a: unknown[]) => unknown, operation, targetOf(args))(...args) as Promise<Result>
  return {
    setPolicy: wrap("setPolicy", client.setPolicy),
    getPolicy: wrap("getPolicy", client.getPolicy),
    listMachines: () =>
      wrap("listMachines", client.listMachines)().then((machines) => machines.map((machine) => typedMachine(machine))),
    fanout: (targets, fn, options) =>
      client.fanout(targets, (machine, context) => fn(typedMachine(machine), context), options),
    getMachine: wrap("getMachine", client.getMachine),
    findMachine: wrap("findMachine", client.findMachine),
    listTools: wrap("listTools", client.listTools),
    resultOf: wrap("resultOf", client.resultOf),
    events: (eventOptions) => client.events(eventOptions),
    close: () => client.close(),
  }
}
