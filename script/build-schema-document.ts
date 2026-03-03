import * as z from "zod"
import { OhMyOpenCodeConfigSchema } from "../src/config/schema"

function removeDefaultedFromRequired(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return schema

  const result = { ...schema }

  if (Array.isArray(result.required) && result.properties && typeof result.properties === "object") {
    const props = result.properties as Record<string, Record<string, unknown>>
    result.required = (result.required as string[]).filter((key) => {
      const prop = props[key]
      return prop && !("default" in prop)
    })
    if ((result.required as string[]).length === 0) {
      delete result.required
    }
  }

  if (result.properties && typeof result.properties === "object") {
    const newProps: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(result.properties as Record<string, unknown>)) {
      newProps[key] = removeDefaultedFromRequired(value as Record<string, unknown>)
    }
    result.properties = newProps
  }

  if (result.items && typeof result.items === "object" && !Array.isArray(result.items)) {
    result.items = removeDefaultedFromRequired(result.items as Record<string, unknown>)
  } else if (Array.isArray(result.items)) {
    result.items = result.items.map((item) => removeDefaultedFromRequired(item as Record<string, unknown>))
  }

  for (const key of ["allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(result[key])) {
      result[key] = (result[key] as Record<string, unknown>[]).map((s) => removeDefaultedFromRequired(s))
    }
  }

  for (const key of ["$defs", "definitions"]) {
    if (result[key] && typeof result[key] === "object") {
      const newDefs: Record<string, unknown> = {}
      for (const [defKey, defValue] of Object.entries(result[key] as Record<string, unknown>)) {
        newDefs[defKey] = removeDefaultedFromRequired(defValue as Record<string, unknown>)
      }
      result[key] = newDefs
    }
  }

  return result
}

export function createOhMyOpenCodeJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(OhMyOpenCodeConfigSchema, {
    target: "draft-7",
    unrepresentable: "any",
  })

  return removeDefaultedFromRequired({
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/dev/assets/oh-my-opencode.schema.json",
    title: "Oh My OpenCode Configuration",
    description: "Configuration schema for oh-my-opencode plugin",
    ...jsonSchema,
  })
}
