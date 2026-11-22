// omo#13638: the in-process `omo account show` that `omo remote` runs first reports the credential store's own error
// lines (the recovery hint for an invalid stored sign-in) to its error sink, never into the stdout the remote verbs parse.
import { describe, expect, test } from "bun:test"

import { createCredentialStore } from "../../omo-opencode/src/cli/service-auth/keystore"
import { ACCOUNT_EXIT, readAccountInProcess } from "../account-show"

describe("omo remote account read", () => {
  test("#given an invalid stored sign-in #when the remote verbs read the account #then the store's recovery hint reaches the error sink", async () => {
    // given
    const store = createCredentialStore("http://127.0.0.1:1", {
      platform: "darwin",
      secrets: { get: async () => "not a credential", set: async () => {}, delete: async () => false },
    })
    const errors: string[] = []

    // when
    const result = await readAccountInProcess(
      (line) => errors.push(line),
      () => store,
    )

    // then
    expect({
      exitCode: result.exitCode,
      hintInErrors: errors.some((line) => line.includes("omo account forget")),
      hintInStdout: result.stdout.includes("omo account forget"),
    }).toEqual({ exitCode: ACCOUNT_EXIT.failed, hintInErrors: true, hintInStdout: false })
  })
})
