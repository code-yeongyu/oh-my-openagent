import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { createGatewayStore } from "../../omo-senpi/src/components/thread/gateway/store"
import { createLiveThreadSurface } from "../../omo-senpi/src/components/thread/live-surface"
import { createThreadSdk } from "../../omo-senpi/src/components/thread/sdk"
import { withContractHost, type ContractHost, type ContractHostOptions } from "../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { DAEMON_EXIT } from "../bin/lib/daemon-args.js"
import { runAdoptCommand } from "../bin/lib/daemon-adopt.js"

/**
 * `omo daemon adopt` over the real thread SDK and socket client against an attach-capable host
 * (wire contract v1.1): an attach refusal reaches adopt as the release's own refusal, so the
 * documented exit codes (docs/reference/omo-daemon.md, Exit codes) and the release_failed
 * recovery hold exactly as against a host without attachments.
 */

function capture() {
  const chunks: string[] = []
  return { write: (text: string) => void chunks.push(text), text: () => chunks.join("") }
}

async function adopt(host: ContractHost): Promise<{ readonly outcome: unknown; readonly stderr: string }> {
  const store = createGatewayStore({ agentDir: host.root })
  const surface = createLiveThreadSurface(undefined, {
    env: { OMO_CODING_AGENT_DIR: host.root, SENPI_RPC_SOCKET: host.socket, SENPI_RPC_KEY_ROOT: host.root },
    statusAll: async () => undefined, registry: async () => [],
  })
  const sdk = createThreadSdk({ agentDir: host.root, cwd: host.root, uid: 501, user: "adopt-test", host: surface, store })
  const stdout = capture()
  const stderr = capture()
  try {
    return { outcome: await runAdoptCommand(["dur-selected"], { sdk, stdout, stderr }), stderr: stderr.text() }
  } finally {
    await sdk.dispose()
  }
}

describe("omo daemon adopt against an attach-capable host", () => {
  const cases: readonly [string, ContractHostOptions, number, string][] = [
    ["the session vanished", { attachRefusal: "unknown_session" }, DAEMON_EXIT.notRunning, "unknown_session"],
    ["the host is draining", { attachRefusal: "host_draining" }, DAEMON_EXIT.unsupported, "host_draining"],
  ]
  test.each(cases)("#given %s #when adopt releases it #then it exits with the documented code and names the refusal", async (_name, options, exit, code) => {
    await withContractHost({ auth: true, ...options }, async (host) => {
      const { outcome, stderr } = await adopt(host)
      expect(outcome).toBe(exit)
      expect(stderr).toContain(`${code}:`)
      expect(host.mutations).toEqual([])
    })
  })

  test("#given a release that fails after the session is already gone #when adopt asks again #then the gone session counts as released and is resumed here", async () => {
    await withContractHost({ auth: true, releaseFailsThenGone: true }, async (host) => {
      const { outcome } = await adopt(host)
      // The host names the session file as the contract host builds it: path.join, so backslashes on win32.
      expect(outcome).toEqual({ launch: ["--session", join(host.root, "session.jsonl")], cwd: host.root })
    })
  })
})
