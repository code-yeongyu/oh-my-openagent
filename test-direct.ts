import { zodToJsonSchema } from "zod-to-json-schema"
import { z } from "zod"

// Simple test schema
const testSchema = z.object({
  name: z.string(),
  age: z.number().optional()
})

const result = zodToJsonSchema(testSchema, { target: "draft7" })
console.log(JSON.stringify(result, null, 2))
