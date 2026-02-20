import * as z from "zod"
import { OhMyOpenCodeConfigSchema } from "../src/config/schema"

export function createOhMyOpenCodeJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(OhMyOpenCodeConfigSchema, {
    target: "draft-07",
    unrepresentable: "any",
  })

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
    title: "Oh My OpenCode Configuration",
    description: "Configuration schema for oh-my-opencode plugin",
    ...jsonSchema,
  }
}
