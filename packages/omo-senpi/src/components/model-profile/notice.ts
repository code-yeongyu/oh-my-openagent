import type { AuthFailure } from "./request-auth"
import type { ModelProfileResolution, ModelProfileSummary } from "./resolve"

const MID_SESSION_NOTE = "mid-session fallback follows senpi's retry chains"

export type AuthFailedDetail = { readonly provider: string; readonly model: string; readonly reason: AuthFailure["reason"] }

export function authFailedDetails(failures: readonly AuthFailure[]): { authFailed?: AuthFailedDetail[] } {
  return failures.length === 0
    ? {}
    : { authFailed: failures.map(({ provider, model, reason }) => ({ provider, model, reason })) }
}

function profileLabel(profile: ModelProfileSummary): string {
  return profile.displayName !== profile.id ? `"${profile.id}" (${profile.displayName})` : `"${profile.id}"`
}

// The `/login` slash command exists only in the interactive terminal, which this component never
// applies to: a desktop (rpc) client re-authenticates from its provider settings, and a headless
// run needs an interactive session for the login flow.
function reauthenticate(provider: string, mode: string | undefined): string {
  return mode === "rpc"
    ? `re-authenticate ${provider} in Provider authentication settings`
    : `re-authenticate ${provider} in an interactive session with /login ${provider}`
}

function skippedNote(failure: AuthFailure, mode: string | undefined): string {
  switch (failure.reason) {
    case "refresh":
      return `skipped ${failure.provider}: its login could not be refreshed at session start (if it has expired, ${reauthenticate(failure.provider, mode)}; a connectivity problem clears on the next start)`
    case "credentials":
      return `skipped ${failure.provider}: its credentials did not resolve at session start (check that provider's credential configuration)`
    case "request":
      return `skipped ${failure.provider}/${failure.model}: its request configuration did not resolve (check that model's headers in models.json)`
  }
}

export function authFailureNote(failures: readonly AuthFailure[], mode: string | undefined): string {
  return failures.map((failure) => skippedNote(failure, mode)).join("; ")
}

export function noticeContent(
  resolution: ModelProfileResolution,
  authFailures: readonly AuthFailure[],
  mode: string | undefined,
): string {
  switch (resolution.kind) {
    case "resolved": {
      const model = `${resolution.provider}/${resolution.modelId}`
      const reasoning = resolution.reasoning !== undefined ? ` ${resolution.reasoning}` : ""
      const skipped = resolution.skipped.length > 0 ? ` (skipped: ${resolution.skipped.join(", ")})` : ""
      const auth = authFailures.length > 0 ? `; ${authFailureNote(authFailures, mode)}` : ""
      return `OmO Native: model profile ${profileLabel(resolution.profile)} selected ${model}${reasoning}${skipped}${auth}; ${MID_SESSION_NOTE}`
    }
    case "unavailable":
      if (authFailures.length > 0) {
        return `OmO Native: model profile ${profileLabel(resolution.profile)} has no model whose credentials resolve; ${authFailureNote(authFailures, mode)}; keeping senpi's default model`
      }
      return `OmO Native: model profile ${profileLabel(resolution.profile)} has no available model; none of the chain is in this session's model registry (${resolution.chain.join(", ")}); keeping senpi's default model`
    case "empty":
      return `OmO Native: model profile ${profileLabel(resolution.profile)} defines no models; keeping senpi's default model`
    case "unknown":
      return `OmO Native: ${resolution.message}`
  }
}
