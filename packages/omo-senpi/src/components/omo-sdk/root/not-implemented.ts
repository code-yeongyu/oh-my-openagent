import type { OmoFailure, OmoStream, RootCallKey } from "../contract"
import { ROOT_CALLS } from "../contract/calls"

// Design 4.4: a call whose slice has not landed answers not_implemented as data. It never counts as built: a scenario
// that runs into it fails (script/sdk-parity/conformance.ts), so its row stays in unresolved.json.
const failureOf = (key: RootCallKey): OmoFailure => ({
  kind: "error",
  error: {
    code: "not_implemented",
    message: `${key} is not built in this release of the omo SDK.`,
    next_action: "Use the omo command that offers it until a release of the SDK builds this call.",
  },
})

function endedStream(failure: OmoFailure["error"]): OmoStream<never, never> {
  return {
    stop: () => undefined,
    async *[Symbol.asyncIterator]() {
      yield { kind: "end", failure }
    },
  }
}

export function notImplemented(key: RootCallKey): (...args: unknown[]) => unknown {
  const failure = failureOf(key)
  if (ROOT_CALLS[key].answer === "stream") return () => endedStream(failure.error)
  return async () => failure
}
