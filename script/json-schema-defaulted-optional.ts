function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Zod's output-mode JSON Schema lists every defaulted field as required, because the parsed value
 * always carries it. A config file is parser input, where such a field may be left out, so the
 * published schema rejected configs the loader accepts (#6445). This drops each required name whose
 * property schema declares a default and changes nothing else: `additionalProperties: false` stays,
 * so unknown keys are still reported. Mutates `node` in place.
 */
export function optionalizeDefaultedProperties(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) optionalizeDefaultedProperties(child)
    return
  }
  if (!isRecord(node)) return
  const properties = node.properties
  if (Array.isArray(node.required) && isRecord(properties)) {
    const required = node.required.filter((name) => {
      const property = typeof name === "string" ? properties[name] : undefined
      return !(isRecord(property) && "default" in property)
    })
    if (required.length > 0) node.required = required
    else delete node.required
  }
  for (const child of Object.values(node)) optionalizeDefaultedProperties(child)
}
