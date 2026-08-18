import { expect, test } from "bun:test"

import { externalTerminationMatchesPlatformFacts, killSenpiHost } from "./task-rpc-e2e-scenarios.mjs"

test("#given Windows omits signal provenance #when an externally terminated task reports code 1 #then the record matches platform facts", () => {
  expect(externalTerminationMatchesPlatformFacts({
    status: "error",
    killed: false,
    error_message: "RPC child exited with code 1",
  }, "win32", true)).toBe(true)
})

test("#given Windows preserves signal provenance #when an externally terminated task is marked killed #then the stronger record still matches", () => {
  expect(externalTerminationMatchesPlatformFacts({ status: "error", killed: true }, "win32", true)).toBe(true)
})

test("#given a child exits before termination injection #when its Windows code-1 record is evaluated #then it cannot prove external termination", () => {
  expect(externalTerminationMatchesPlatformFacts({
    status: "error",
    killed: false,
    error_message: "RPC child exited with code 1",
  }, "win32", false)).toBe(false)
})

test("#given Windows reports malformed crash facts #when external termination is evaluated #then the record does not match", () => {
  expect(externalTerminationMatchesPlatformFacts({
    status: "error",
    killed: false,
    error_message: "RPC child exited unexpectedly",
  }, "win32", true)).toBe(false)
  expect(externalTerminationMatchesPlatformFacts({
    status: "error",
    killed: false,
    error_message: "prefix RPC child exited with code 1 suffix",
  }, "win32", true)).toBe(false)
})

test("#given POSIX preserves signal provenance #when an externally terminated task is marked killed #then the record matches", () => {
  expect(externalTerminationMatchesPlatformFacts({ status: "error", killed: true }, "linux", true)).toBe(true)
})

test("#given POSIX reports only a nonzero exit #when external termination is evaluated #then killed provenance is still required", () => {
  expect(externalTerminationMatchesPlatformFacts({
    status: "error",
    killed: false,
    error_message: "RPC child exited with code 1",
  }, "linux", true)).toBe(false)
})

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
