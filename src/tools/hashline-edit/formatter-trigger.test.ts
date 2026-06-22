import { beforeEach, describe, expect, it, mock } from "bun:test"
import {
  buildFormatterCommand,
  clearFormatterCache,
  type FormatterClient,
  resolveFormatters,
  runFormattersForFile,
} from "./formatter-trigger"

function createMockClient(config: Record<string, unknown> = {}): FormatterClient {
  return {
    config: {
      get: mock(() => Promise.resolve({ data: config })),
    },
  }
}

describe("buildFormatterCommand", () => {
  it("substitutes $FILE with the actual file path", () => {
    //#given
    const command = ["prettier", "--write", "$FILE"]
    const filePath = "/src/index.ts"

    //#when
    const result = buildFormatterCommand(command, filePath)

    //#then
    expect(result).toEqual(["prettier", "--write", "/src/index.ts"])
  })

  it("substitutes multiple $FILE occurrences in the same arg", () => {
    //#given
    const command = ["echo", "$FILE:$FILE"]
    const filePath = "test.ts"

    //#when
    const result = buildFormatterCommand(command, filePath)

    //#then
    expect(result).toEqual(["echo", "test.ts:test.ts"])
  })

  it("returns command unchanged when no $FILE present", () => {
    //#given
    const command = ["prettier", "--check", "."]

    //#when
    const result = buildFormatterCommand(command, "/some/file.ts")

    //#then
    expect(result).toEqual(["prettier", "--check", "."])
  })
})

describe("resolveFormatters", () => {
  beforeEach(() => {
    clearFormatterCache()
  })

  it("resolves formatters from config.formatter section", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        prettier: {
          command: ["prettier", "--write", "$FILE"],
          extensions: [".ts", ".tsx"],
        },
      },
    })

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.get(".ts")).toEqual([{ command: ["prettier", "--write", "$FILE"], environment: {} }])
    expect(result.get(".tsx")).toEqual([{ command: ["prettier", "--write", "$FILE"], environment: {} }])
  })

  it("resolves formatters from experimental.hook.file_edited section", async () => {
    //#given
    const client = createMockClient({
      experimental: {
        hook: {
          file_edited: {
            ".go": [{ command: ["gofmt", "-w", "$FILE"], environment: { GOPATH: "/go" } }],
          },
        },
      },
    })

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.get(".go")).toEqual([{ command: ["gofmt", "-w", "$FILE"], environment: { GOPATH: "/go" } }])
  })

  it("normalizes extensions without leading dot", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        biome: {
          command: ["biome", "format", "$FILE"],
          extensions: ["ts", "js"],
        },
      },
    })

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.has(".ts")).toBe(true)
    expect(result.has(".js")).toBe(true)
  })

  it("skips disabled formatters", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        prettier: {
          disabled: true,
          command: ["prettier", "--write", "$FILE"],
          extensions: [".ts"],
        },
      },
    })

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.size).toBe(0)
  })

  it("skips formatters without command", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        prettier: {
          extensions: [".ts"],
        },
      },
    })

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.size).toBe(0)
  })

  it("skips formatters without extensions", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        prettier: {
          command: ["prettier", "--write", "$FILE"],
        },
      },
    })

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.size).toBe(0)
  })
})
