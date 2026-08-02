import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { createOmoJsonSchema, OMO_SCHEMA_ID } from "./build-omo-schema-document"

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}

function requiredSchemaRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new TypeError(`Expected generated omo schema ${path} to be an object`)
  }
  return value
}

function collectSchemaIds(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(collectSchemaIds)
  if (!isRecord(value)) return []
  return [
    ...(typeof value.$id === "string" ? [value.$id] : []),
    ...Object.values(value).flatMap(collectSchemaIds),
  ]
}

describe("build-omo-schema-document", () => {
  test("#given a missing schema path #when required #then the assertion fails with the path", () => {
    // given
    const missingValue = undefined
    const missingPath = "properties.profiles"

    // when
    const readMissingValue = () => requiredSchemaRecord(missingValue, missingPath)

    // then
    expect(readMissingValue).toThrow(
      `Expected generated omo schema ${missingPath} to be an object`,
    )
  })

  test("#given the omo config schema #when generated #then it is a draft-7 document with the config sections", () => {
    // given
    const expectedDraft = "http://json-schema.org/draft-07/schema#"

    // when
    const schema = createOmoJsonSchema()

    // then
    expect(schema.$schema).toBe(expectedDraft)
    expect(schema.$id).toBe(OMO_SCHEMA_ID)
    expect(schema.title).toBe("Omo Configuration")
    const properties = requiredSchemaRecord(schema.properties, "properties")
    expect(properties.categories).toBeDefined()
    expect(properties.agents).toBeDefined()
    expect(properties.task).toBeDefined()
    expect(properties.teams).toBeDefined()
  })

  test("#given the strict root object #when generated #then $schema is an allowed property and extras are rejected", () => {
    // given
    const schema = createOmoJsonSchema()

    // when
    const properties = requiredSchemaRecord(schema.properties, "properties")

    // then
    expect(properties.$schema).toBeDefined()
    expect(schema.additionalProperties).toBe(false)
  })

  test("#given embedded OpenCode schemas #when generated #then only the unified root declares an identity", () => {
    // given
    const schema = createOmoJsonSchema()

    // when
    const schemaIds = collectSchemaIds(schema)

    // then
    expect(schemaIds).toEqual([OMO_SCHEMA_ID])
  })

  test("#given omitted default-backed config fields #when validated #then root and profile migration shapes are accepted", () => {
    // given
    const schema = createOmoJsonSchema()
    const properties = requiredSchemaRecord(schema.properties, "properties")
    const profiles = requiredSchemaRecord(properties.profiles, "properties.profiles")
    const profile = requiredSchemaRecord(
      profiles.additionalProperties,
      "properties.profiles.additionalProperties",
    )
    const profileProperties = requiredSchemaRecord(
      profile.properties,
      "properties.profiles.additionalProperties.properties",
    )
    const rootOpenCode = requiredSchemaRecord(
      properties["[opencode]"],
      'properties["[opencode]"]',
    )
    const profileOpenCode = requiredSchemaRecord(
      profileProperties["[opencode]"],
      'properties.profiles.additionalProperties.properties["[opencode]"]',
    )
    const validator = z.fromJSONSchema(
      schema as Parameters<typeof z.fromJSONSchema>[0],
    )
    const rootDocument = {
      $schema: OMO_SCHEMA_ID,
      "[opencode]": {},
    }
    const profileDocument = {
      $schema: OMO_SCHEMA_ID,
      profiles: {
        kimi: {
          "[opencode]": {},
        },
      },
    }

    // when
    const rootResult = validator.safeParse(rootDocument)
    const profileResult = validator.safeParse(profileDocument)

    // then
    expect(schema.required ?? []).not.toContain("profiles")
    expect(rootOpenCode.required ?? []).not.toContain("git_master")
    expect(profileOpenCode.required ?? []).not.toContain("git_master")
    expect(rootResult.success).toBe(true)
    expect(profileResult.success).toBe(true)
  })

  test("#given the todo-4 and todo-15 golden migrated document #when validated by the generated schema #then base and profile OpenCode blocks validate", () => {
    // given
    const schema = createOmoJsonSchema()
    const goldenMigratedDocument = {
      $schema: OMO_SCHEMA_ID,
      categories: {
        deep: {
          model: "kimi/k2.5",
          reasoningEffort: "high",
        },
      },
      models: {
        kimi: {
          model: "kimi/k2.5",
          variant: "thinking",
          reasoningEffort: "high",
        },
      },
      "[opencode]": {
        background_task: {
          defaultConcurrency: 4,
        },
        team_mode: {
          enabled: true,
          tmux_visualization: false,
          max_parallel_members: 4,
          max_members: 8,
          max_messages_per_run: 10000,
          max_wall_clock_minutes: 120,
          max_member_turns: 500,
          message_payload_max_bytes: 32768,
          recipient_unread_max_bytes: 262144,
          mailbox_poll_interval_ms: 3000,
        },
      },
      "[senpi]": {
        task: {
          default_concurrency: 3,
        },
      },
      "[codex]": {
        codegraph: {
          daemon: false,
        },
      },
      profiles: {
        kimi: {
          models: {
            kimi: {
              variant: "fast",
            },
          },
          "[opencode]": {
            background_task: {
              defaultConcurrency: 2,
            },
          },
          "[senpi]": {
            task: {
              default_concurrency: 2,
            },
          },
          "[codex]": {
            codegraph: {
              enabled: false,
            },
          },
        },
      },
      _migrations: ["2026-07-opencode-config-unification"],
      legacy_migrations: {
        "oh-my-opencode.json": {
          migrated: true,
        },
      },
    }
    const validator = z.fromJSONSchema(
      schema as Parameters<typeof z.fromJSONSchema>[0],
    )

    // when
    const result = validator.safeParse(goldenMigratedDocument)

    // then
    expect(result.success).toBe(true)
  })

  test("#given an out-of-range OpenCode team maximum #when validated by the generated schema #then root and profile blocks are rejected", () => {
    // given
    const schema = createOmoJsonSchema()
    const invalidTeamMode = {
      enabled: true,
      tmux_visualization: false,
      max_parallel_members: 4,
      max_members: 99,
      max_messages_per_run: 10000,
      max_wall_clock_minutes: 120,
      max_member_turns: 500,
      message_payload_max_bytes: 32768,
      recipient_unread_max_bytes: 262144,
      mailbox_poll_interval_ms: 3000,
    }
    const invalidRootDocument = {
      "[opencode]": {
        team_mode: invalidTeamMode,
      },
    }
    const invalidProfileDocument = {
      profiles: {
        kimi: {
          "[opencode]": {
            team_mode: invalidTeamMode,
          },
        },
      },
    }
    const validator = z.fromJSONSchema(
      schema as Parameters<typeof z.fromJSONSchema>[0],
    )

    // when
    const rootResult = validator.safeParse(invalidRootDocument)
    const profileResult = validator.safeParse(invalidProfileDocument)

    // then
    expect(rootResult.success).toBe(false)
    expect(profileResult.success).toBe(false)
  })

  test("#given an unknown top-level key #when validated by the generated schema #then it is rejected", () => {
    // given
    const schema = createOmoJsonSchema()
    const invalidDocument = {
      unexpected: true,
    }
    const validator = z.fromJSONSchema(
      schema as Parameters<typeof z.fromJSONSchema>[0],
    )

    // when
    const result = validator.safeParse(invalidDocument)

    // then
    expect(result.success).toBe(false)
  })

  test("#given the schema generator #when it runs twice #then it produces no diff", () => {
    // given
    const first = JSON.stringify(createOmoJsonSchema(), null, 2)

    // when
    const second = JSON.stringify(createOmoJsonSchema(), null, 2)

    // then
    expect(second).toBe(first)
  })
})
