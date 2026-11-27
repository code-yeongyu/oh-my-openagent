import type { CallInput } from "./contract-check"
import type { FieldSchema } from "./schema"

// A call's input schema as its registry row lists it: one map of fields. A schema that is a union of object forms (two
// typed forms of one call, engine.config.setResource) lists every field any form takes, the first form's schema for a
// field two forms share, as required only what every form requires, and as formRequired what every form that has it
// requires (a field that selects the form, such as setResource's enabled or state, pairs with no scenario).
// Description annotations are prose and are dropped; a field named "description" is a field and is kept.
type ObjectSchema = {
  readonly properties?: Readonly<Record<string, FieldSchema>>
  readonly required?: readonly string[]
}
type Schema = ObjectSchema & { readonly anyOf?: readonly ObjectSchema[] }

const projectSchema = (schema: unknown): Schema =>
  JSON.parse(
    JSON.stringify(schema, (key, value: unknown) =>
      key === "description" && typeof value === "string" ? undefined : value,
    ),
  ) as Schema

export function callInputOf(schema: unknown): CallInput {
  const json = projectSchema(schema)
  const forms = json.anyOf ?? [json]
  const properties: Record<string, FieldSchema> = {}
  for (const form of forms)
    for (const [field, value] of Object.entries(form.properties ?? {}))
      if (!(field in properties)) properties[field] = value
  const required = Object.keys(properties).filter((field) =>
    forms.every((form) => form.required?.includes(field) === true),
  )
  const formRequired = Object.keys(properties).filter((field) =>
    forms.every((form) => !(field in (form.properties ?? {})) || form.required?.includes(field) === true),
  )
  return { properties, required, formRequired }
}
