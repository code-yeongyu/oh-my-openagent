import { pathToFileURL } from "node:url"

import { OMO_NATIVE_EVENT_SCHEMAS } from "../packages/omo-senpi/src/components/telemetry/product-identity.ts"

const BEGIN_SENTINEL = "<!-- BEGIN GENERATED SCHEMA -->"
const END_SENTINEL = "<!-- END GENERATED SCHEMA -->"

export function generateTelemetrySchemaBlock(schemas = OMO_NATIVE_EVENT_SCHEMAS) {
  if (schemas === null || typeof schemas !== "object" || Array.isArray(schemas)) {
    throw new TypeError("Telemetry event schemas must be an object")
  }

  const entries = Object.entries(schemas)
  if (entries.length === 0) {
    throw new Error("Telemetry event schemas must contain at least one event")
  }

  const rows = entries.flatMap(([eventName, properties]) => {
    assertMarkdownIdentifier(eventName, "event name")
    if (properties === null || typeof properties !== "object" || Array.isArray(properties) || Object.keys(properties).length === 0) {
      throw new Error(`Telemetry event ${eventName} must contain at least one property schema`)
    }

    return Object.entries(properties).map(([propertyName, schema]) => {
      assertMarkdownIdentifier(propertyName, `property for ${eventName}`)
      if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
        throw new Error(`Telemetry property ${eventName}.${propertyName} must contain schema metadata`)
      }
      const type = schema.type
      if (type !== "boolean" && type !== "number" && type !== "string") {
        throw new Error(`Telemetry property ${eventName}.${propertyName} has invalid type ${String(type)}`)
      }
      const values = schema.values
      if (values !== undefined && (!Array.isArray(values) || values.length === 0)) {
        throw new Error(`Telemetry property ${eventName}.${propertyName} values must be a non-empty array`)
      }
      const valueCell = values === undefined ? "-" : values.map((value) => {
        assertMarkdownIdentifier(value, `allowed value for ${eventName}.${propertyName}`)
        return `\`${value}\``
      }).join(", ")
      return `| \`${eventName}\` | \`${propertyName}\` | \`${type}\` | ${valueCell} |`
    })
  })

  return [
    BEGIN_SENTINEL,
    "## Event schema",
    "",
    "| Event | Property | Type | Allowed values |",
    "|-------|----------|------|----------------|",
    ...rows,
    END_SENTINEL,
  ].join("\n")
}

function assertMarkdownIdentifier(value, description) {
  if (typeof value !== "string" || value.length === 0 || /[\n\r`|]/u.test(value)) {
    throw new Error(`Telemetry ${description} must be a non-empty Markdown-safe string`)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.stdout.write(`${generateTelemetrySchemaBlock()}\n`)
}
