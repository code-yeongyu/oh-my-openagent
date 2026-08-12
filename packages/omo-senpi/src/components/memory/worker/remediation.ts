export function reflectionRemediation(reason: string | undefined, detail: string | undefined): string {
  const combined = `${reason ?? ""} ${detail ?? ""}`.toLowerCase()
  if (combined.includes("model-not-found") || combined.includes("model_not_visible") || combined.includes("model not found")) {
    return "the reflection child cannot see the configured category model; adjust memory.reflection category/model in your omo config"
  }
  if (combined.includes("spawn") || combined.includes("enoent")) {
    return "senpi executable not resolvable for the reflection child; set SENPI_BIN"
  }
  if (combined.includes("api key") || combined.includes("auth_missing")) {
    return "run /login <provider>"
  }
  return "inspect runtime/reflection-sessions/<runId>/child-stderr.log"
}
