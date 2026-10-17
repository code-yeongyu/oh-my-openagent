import { describe, expect, test } from "bun:test"

import { createKernelToolBindings, type KernelToolBindingRegistry } from "../kernel-tools/bindings"
import { resolveKernelToolGrant, type KernelToolGrant } from "../kernel-tools/resolve"
import { fakeKernelTools } from "../runners/in-process/__fixtures__/kernel-tools-fakes"
import { deliveryFixture } from "./__fixtures__/delivery"

const NAMES = ["fixture_lookup"] as const

async function poolGrant(): Promise<KernelToolGrant> {
  const capability = fakeKernelTools()
  capability.define({ name: "fixture_lookup" })
  const resolved = await resolveKernelToolGrant({ requestedNames: [...NAMES], capability, executionMode: "in-process" })
  if (resolved.kind !== "granted") throw new Error(`expected a grant, got ${resolved.kind}`)
  return resolved.grant
}

async function poolWithTools(bindings: KernelToolBindingRegistry) {
  const grant = await poolGrant()
  const f = deliveryFixture({ kernelToolBindings: bindings, kernelTools: { names: NAMES, grant } })
  expect(bindings.get(f.pool.pool_id)).toBe(grant)
  return { f, grant }
}

/**
 * A pool binding is the ONLY strong reference the engine keeps to the parent kernel for worker
 * spawns, so every path that ends a pool must drop it. The assertions read the map itself - the
 * binding is gone by key, and the engine holds no other entry.
 */
describe("workpool parent kernel-tool bindings", () => {
  test("#given a pool with parent tools #when it is cancelled #then the binding is released", async () => {
    const bindings = createKernelToolBindings()
    const { f } = await poolWithTools(bindings)

    f.manager.workpools.cancel(f.caller, f.pool.pool_id)

    expect(bindings.get(f.pool.pool_id)).toBeUndefined()
    expect(bindings.keys()).toEqual([])
  })

  test("#given a closed pool #when its last worker finished every item #then the binding is released", async () => {
    const bindings = createKernelToolBindings()
    const { f } = await poolWithTools(bindings)
    const worker = await f.start("a")

    f.yieldResults(worker.taskId, worker.epoch, [{ key: "a", data: 1 }])
    await f.settle(worker.taskId)
    expect(bindings.get(f.pool.pool_id)).toBeDefined()
    f.manager.workpools.close(f.caller, f.pool.pool_id)

    expect(bindings.get(f.pool.pool_id)).toBeUndefined()
    expect(bindings.keys()).toEqual([])
  })

  test("#given a live pool #when the engine is disposed #then no pool binding survives the engine", async () => {
    const bindings = createKernelToolBindings()
    const { f } = await poolWithTools(bindings)

    f.manager.workpools.dispose()

    expect(bindings.size).toBe(0)
  })
})
