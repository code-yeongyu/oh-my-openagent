import { describe, expect, test } from "bun:test"

import type { OmoFailure, OmoPrincipal, RootCallKey } from "../contract"
import { assembleRoot } from "./assemble"
import { boundaryRefusals } from "./authority"
import type { NamespaceServing } from "./members"

// Security owner's ruling: every refusal the root answers at its boundary is handed to the namespaces that record
// refusals (refused, with its reason code, never the input), whichever kind it is.
function rootRecording(principal: OmoPrincipal) {
  const recorded: { readonly key: RootCallKey; readonly code: string }[] = []
  const serving: NamespaceServing = {
    members: { "account.whoami": (async () => ({ kind: "ok", value: { signed_in: false } })) as never },
    recordRefusal: async (key, code) => {
      recorded.push({ key, code })
    },
  }
  const refusals = new Map<RootCallKey, OmoFailure["error"]>(boundaryRefusals(principal, {}))
  return { root: assembleRoot([serving], {}, { env: {}, cwd: "/", principal }, refusals), recorded }
}

describe("every boundary refusal is recorded", () => {
  test("#given a pair with no matrix line #when it is called #then its refusal is recorded with sender_not_allowed", async () => {
    const { root, recorded } = rootRecording({ kind: "connector", binding: "b-1" })
    await root.account.show({})
    expect(recorded).toContainEqual({ key: "account.show", code: "sender_not_allowed" })
  })

  test("#given a pair whose line refuses it #when it is called #then its refusal is recorded with the line's code", async () => {
    const principal: OmoPrincipal = { kind: "session", session_id: "s-1" }
    const [key, error] =
      [...boundaryRefusals(principal, {})].find(([, refusal]) => refusal.details?.reason === undefined) ?? []
    if (key === undefined || error === undefined) throw new Error("no refused line for a session")
    const { root, recorded } = rootRecording(principal)
    const member = key.split(".").reduce<unknown>((node, part) => Reflect.get(Object(node), part), root)
    const answer = (member as (input: unknown) => unknown)({})
    if (typeof answer === "object" && answer !== null && Symbol.asyncIterator in answer)
      for await (const _event of answer as AsyncIterable<unknown>) break
    else await answer
    expect(recorded).toContainEqual({ key, code: error.code })
  })

  test("#given an admitted call with an invalid input #when it is called #then its refusal is recorded with invalid_arguments, never the input", async () => {
    const { root, recorded } = rootRecording({ kind: "script", uid: 501 })
    expect(await root.account.whoami("secret-text" as never)).toMatchObject({ error: { code: "invalid_arguments" } })
    expect(recorded).toEqual([{ key: "account.whoami", code: "invalid_arguments" }])
    expect(JSON.stringify(recorded)).not.toContain("secret-text")
  })
})
