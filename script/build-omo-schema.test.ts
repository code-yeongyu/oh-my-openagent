import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { createOmoJsonSchema, OMO_SCHEMA_ID } from "./build-omo-schema-document"

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}

describe("build-omo-schema-document", () => {
  test("#given the omo config schema #when generated #then it is a draft-7 document with the config sections", () => {
    // given
    const expectedDraft = "http://json-schema.org/draft-07/schema#"

    // when
    const schema = createOmoJsonSchema()

    // then
    expect(schema.$schema).toBe(expectedDraft)
    expect(schema.$id).toBe(OMO_SCHEMA_ID)
    expect(schema.title).toBe("OmO Configuration")
    const properties = isRecord(schema.properties) ? schema.properties : {}
    expect(properties.categories).toBeDefined()
    expect(properties.agents).toBeDefined()
    expect(properties.task).toBeDefined()
    expect(properties.teams).toBeDefined()
  })

  test("#given the strict root object #when generated #then $schema is an allowed property and extras are rejected", () => {
    // given
    const schema = createOmoJsonSchema()

    // when
    const properties = isRecord(schema.properties) ? schema.properties : {}

    // then
    expect(properties.$schema).toBeDefined()
    expect(schema.additionalProperties).toBe(false)
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
      telemetry: {
        enabled: false,
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
          telemetry: {
            enabled: false,
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
