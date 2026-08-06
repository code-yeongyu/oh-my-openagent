export function parseSkillMcpArguments(
  argsJson: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!argsJson) return {}
  if (typeof argsJson === "object" && argsJson !== null) {
    return argsJson
  }

  try {
    const jsonString = argsJson.startsWith("'") && argsJson.endsWith("'") ? argsJson.slice(1, -1) : argsJson
    const parsed = JSON.parse(jsonString)
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Arguments must be a JSON object")
    }

    return parsed as Record<string, unknown>
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Invalid arguments JSON: ${errorMessage}\n\n` +
        `Expected a valid JSON object, e.g.: '{"key": "value"}'\n` +
        `Received: ${argsJson}`,
    )
  }
}
