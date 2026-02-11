import { OhMyOpenCodeConfigSchema } from "./src/config/schema"
import { zodToJsonSchema } from "zod-to-json-schema"

const jsonSchema = zodToJsonSchema(OhMyOpenCodeConfigSchema, { target: "draft7" })
console.log("Schema keys:", Object.keys(jsonSchema))
console.log("Type:", jsonSchema.type)
console.log("Properties keys:", Object.keys(jsonSchema.properties || {}))
