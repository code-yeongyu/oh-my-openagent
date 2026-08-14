import type { ReflectionFailureError } from "./failure-error"

export function reflectionRemediation(
  reason: string | undefined,
  detail: string | undefined,
  failureError?: ReflectionFailureError,
): string {
  const combined = `${reason ?? ""} ${detail ?? ""}`.toLowerCase()
  // Pre-spawn resolution failure: no child ever ran, so never point at child-stderr.log here.
  if (combined.includes("category_unavailable") || combined.includes("could not resolve a usable model")) {
    return "no connected provider offers a model for the memory reflection category; run /login <provider>, or pin categories.<category>.model (or memory.reflection.category) in omo.json"
  }
  if (combined.includes("model-not-found") || combined.includes("model_not_visible") || combined.includes("model not found")) {
    return "the reflection child cannot see the configured category model; adjust memory.reflection category/model in your omo config"
  }
  const missingPath = failureError?.code?.toUpperCase() === "ENOENT" && failureError.path !== undefined
    ? failureError.path
    : legacyMissingPath(detail) ?? legacyMissingPath(reason)
  if (missingPath !== undefined) {
    return `the reflection child could not use ${missingPath}; check that path exists and is writable`
  }
  if (combined.includes("spawn") || combined.includes("enoent")) {
    return "senpi executable not resolvable for the reflection child; set SENPI_BIN"
  }
  if (combined.includes("api key") || combined.includes("auth_missing")) {
    return "run /login <provider>"
  }
  return "inspect runtime/reflection-sessions/<runId>/child-stderr.log"
}

function legacyMissingPath(value: string | undefined): string | undefined {
  if (value === undefined || !/ENOENT/i.test(value)) return undefined
  return /\b(?:access|lstat|mkdir|open|readlink|realpath|rmdir|scandir|stat|unlink)\s+'([\s\S]*)'\s*$/i.exec(value)?.[1]
}
