// Call only after nativeToolOutputEvidence has bound the actor, turn and call.
export function sourceReadPresent(output, source) {
  const parts =
    typeof output === "string"
      ? [output]
      : Array.isArray(output)
        ? output.filter((part) => part?.type === "input_text" && typeof part.text === "string").map((part) => part.text)
        : []
  const wanted = source.trimEnd()
  if (!wanted) return false
  return parts.some((part) => {
    if (part.trimEnd() === wanted) return true
    let value
    try {
      value = JSON.parse(part)
    } catch {
      return part.includes(wanted)
    }
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.chunk_id === "string" &&
      value.exit_code === 0 &&
      typeof value.output === "string" &&
      value.output.includes(wanted)
    )
  })
}
