import { z } from "zod"

const testSchema = z.object({
  name: z.string(),
  age: z.number().optional()
})

// Zod 4 has built-in JSON schema generation
if (typeof testSchema.jsonSchema === 'function') {
  console.log("Zod 4 jsonSchema method exists")
  console.log(JSON.stringify(testSchema.jsonSchema(), null, 2))
} else {
  console.log("No jsonSchema method")
  console.log("Available methods:", Object.keys(testSchema).filter(k => typeof testSchema[k] === 'function'))
}
