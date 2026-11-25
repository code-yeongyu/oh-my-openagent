import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { CoreLoader } from "../../omo-senpi/src/components/omo-sdk"
import type { OmoPrincipal } from "../../omo-senpi/src/components/omo-sdk/contract"
import { assembleOmoSdk } from "../../omo-senpi/src/components/omo-sdk/assembly"
import { diagnosticsLoader } from "../diagnostics-loader"

// Security design 4.3 (#14959): the root refuses these principals before the diagnostics core runs. Each test is the
// refusal scenario of script/sdk-parity/scenarios/diagnostics-authority.json named in its title, driven through the
// real root with the real loader; a spy records every core member that is reached, which must be none.
function rootFor(principal: OmoPrincipal) {
  const reached: string[] = []
  const spied: CoreLoader<"diagnostics"> = async (context) => {
    const core = await diagnosticsLoader(context)
    return Object.fromEntries(
      Object.entries(core).map(([name, member]) => [
        name,
        (...args: unknown[]) => {
          reached.push(name)
          return Reflect.apply(member, undefined, args)
        },
      ]),
    )
  }
  const root = assembleOmoSdk({ env: {}, cwd: tmpdir(), principal }, { cores: { diagnostics: spied } })
  return { root, reached }
}

const CONNECTOR: OmoPrincipal = { kind: "connector", binding: "binding-1" }
const SESSION: OmoPrincipal = { kind: "session", session_id: "session-1" }
const SERVICE: OmoPrincipal = { kind: "service" }

describe("diagnostics refusals at the root boundary", () => {
  const cases = [
    ["diagnostics.run/host-read-refuses-connector", CONNECTOR, "run", {}],
    ["diagnostics.fixReflectionLock/host-change-refuses-connector", CONNECTOR, "fixReflectionLock", {}],
    ["diagnostics.fixReflectionLock/host-change-refuses-session", SESSION, "fixReflectionLock", {}],
    ["diagnostics.fixReflectionLock/host-change-refuses-service", SERVICE, "fixReflectionLock", {}],
    ["diagnostics.reapStaleEngines/host-change-refuses-connector", CONNECTOR, "reapStaleEngines", { pids: [4242] }],
    ["diagnostics.reapStaleEngines/host-change-refuses-session", SESSION, "reapStaleEngines", { pids: [4242] }],
    ["diagnostics.reapStaleEngines/host-change-refuses-service", SERVICE, "reapStaleEngines", { pids: [4242] }],
  ] as const

  for (const [id, principal, call, input] of cases) {
    test(`#given ${id} #when the call is made #then sender_not_allowed answers and no core member runs`, async () => {
      const { root, reached } = rootFor(principal)
      const answer = await Reflect.apply(root.diagnostics[call], undefined, [input])
      expect(answer).toMatchObject({ kind: "error", error: { code: "sender_not_allowed" } })
      expect(reached).toEqual([])
    })
  }
})
