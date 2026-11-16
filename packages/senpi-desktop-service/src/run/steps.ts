import { type ComputerCallStep, classifyComputerCall } from "@oh-my-opencode/senpi-desktop-protocol"
import type { DesktopFacade } from "./facade"

function callStep(target: unknown, step: ComputerCallStep): unknown {
  const path = step.method.split(".")
  let owner: unknown = target
  let member: unknown = target
  for (const key of path) {
    owner = member
    member = typeof member === "object" && member !== null ? Reflect.get(member, key) : undefined
  }
  if (typeof member !== "function") throw new TypeError(`${step.method} is not a function`)
  return Reflect.apply(member, owner, step.args ?? [])
}

/**
 * A call chain as data: the first step on the `desktop` facade, each next step on the value the previous one
 * resolved to (a window or element handle). It fails closed by itself: a chain the protocol tables do not allow
 * (an unknown or prototype name, an unchainable root, a second hop) throws `ComputerCallError` before any step runs.
 */
export async function interpretChain(desktop: DesktopFacade, chain: readonly ComputerCallStep[]): Promise<unknown> {
  classifyComputerCall(chain)
  let value: unknown = desktop
  for (const step of chain) value = await callStep(value, step)
  return value
}
