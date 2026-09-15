import { CORE_SCHEMA, load } from "js-yaml"

// Preserve the original yaml oracle's YAML 1.2 core scalar semantics.
export function parseYaml(content: string): unknown {
  return load(content, { schema: CORE_SCHEMA })
}
