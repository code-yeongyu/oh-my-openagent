import { expect, test } from "bun:test"

import { killSenpiHost } from "./task-rpc-e2e-scenarios.mjs"

test("#given a live Senpi QA host #when it is killed #then teardown routes through tree termination", async () => {
  const calls = []
  const child = { pid: 5151, exitCode: null, signalCode: null }

  const killed = await killSenpiHost(child, async (pid) => {
    calls.push(pid)
    return true
  })

  expect(killed).toBe(true)
  expect(calls).toEqual([5151])
})

test("#given an exited Senpi QA host #when cleanup repeats #then no recycled pid is terminated", async () => {
  const calls = []
  const child = { pid: 5151, exitCode: 0, signalCode: null }

  const killed = await killSenpiHost(child, async (pid) => {
    calls.push(pid)
    return true
  })

  expect(killed).toBe(true)
  expect(calls).toEqual([])
})
