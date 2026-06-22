import * as z from "zod"
import { MatrixxConfigSchema } from "../src/config/schema"

export function createMatrixxJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(MatrixxConfigSchema, {
    target: "draft-7",
    unrepresentable: "any",
  })

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://raw.githubusercontent.com/klpanagi/matrixx/dev/assets/matrixx.schema.json",
    title: "Matrixx Configuration",
    description: "Configuration schema for matrixx plugin",
    ...jsonSchema,
  }
}
