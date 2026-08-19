import { expect, test } from "bun:test"

import { killSenpiHost, summarizeDriveFailure } from "./task-rpc-e2e-scenarios.mjs"

test("#given a senpi host run that persisted no task record #when the failure is summarized #then the child exit and stderr are surfaced", () => {
  const summary = summarizeDriveFailure({
    status: 1,
    signal: null,
    stdout: "",
    stderr: "Error: cannot find module '@code-yeongyu/senpi/rpc-entry'\n",
  })

  expect(summary).toEqual({
    childExitStatus: 1,
    childSignal: null,
    childStderrExcerpt: "Error: cannot find module '@code-yeongyu/senpi/rpc-entry'",
    childStdoutBytes: 0,
  })
})

test("#given a clean senpi host run #when the failure is summarized #then no diagnostic noise is attached", () => {
  expect(summarizeDriveFailure({ status: 0, signal: null, stdout: "{}\n", stderr: "" })).toBeUndefined()
})

test("#given a killed senpi host run #when the failure is summarized #then the signal is surfaced without stderr", () => {
  const summary = summarizeDriveFailure({ status: null, signal: "SIGKILL", stdout: "", stderr: "" })

  expect(summary).toEqual({
    childExitStatus: null,
    childSignal: "SIGKILL",
    childStderrExcerpt: "",
    childStdoutBytes: 0,
  })
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
