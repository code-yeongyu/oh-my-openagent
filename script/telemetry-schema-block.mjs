import { pathToFileURL } from "node:url"

import {
  OMO_NATIVE_COMMON_PROPERTY_SCHEMAS,
  OMO_NATIVE_EVENT_SCHEMAS,
} from "../packages/omo-senpi/src/components/telemetry/product-identity.ts"

const BEGIN_SENTINEL = "<!-- BEGIN GENERATED SCHEMA -->"
const END_SENTINEL = "<!-- END GENERATED SCHEMA -->"

export function generateTelemetrySchemaBlock(
  schemas = OMO_NATIVE_EVENT_SCHEMAS,
  commonProperties = OMO_NATIVE_COMMON_PROPERTY_SCHEMAS,
) {
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
      const cells = describeProperty(eventName, propertyName, schema)
      return `| \`${eventName}\` | \`${propertyName}\` | ${cells} |`
    })
  })

  if (commonProperties === null || typeof commonProperties !== "object" || Array.isArray(commonProperties)
    || Object.keys(commonProperties).length === 0) {
    throw new Error("Telemetry common properties must contain at least one property schema")
  }
  const commonRows = Object.entries(commonProperties).map(([propertyName, schema]) => {
    const cells = describeProperty("common", propertyName, schema)
    return `| \`${propertyName}\` | ${cells} |`
  })

  return [
    BEGIN_SENTINEL,
    "## Event schema",
    "",
    "| Event | Property | Type | Allowed values |",
    "|-------|----------|------|----------------|",
    ...rows,
    "",
    "## Common properties",
    "",
    "Every event above also carries these properties.",
    "",
    "| Property | Type | Allowed values |",
    "|----------|------|----------------|",
    ...commonRows,
    END_SENTINEL,
  ].join("\n")
}

function describeProperty(owner, propertyName, schema) {
  assertMarkdownIdentifier(propertyName, `property for ${owner}`)
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`Telemetry property ${owner}.${propertyName} must contain schema metadata`)
  }
  const type = schema.type
  if (type !== "boolean" && type !== "number" && type !== "string") {
    throw new Error(`Telemetry property ${owner}.${propertyName} has invalid type ${String(type)}`)
  }
  const values = schema.values
  if (values !== undefined && (!Array.isArray(values) || values.length === 0)) {
    throw new Error(`Telemetry property ${owner}.${propertyName} values must be a non-empty array`)
  }
  const valueCell = values === undefined ? "-" : values.map((value) => {
    assertMarkdownIdentifier(value, `allowed value for ${owner}.${propertyName}`)
    return `\`${value}\``
  }).join(", ")
  return `\`${type}\` | ${valueCell}`
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
