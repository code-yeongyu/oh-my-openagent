import { describe, it, expect, beforeEach, mock } from "bun:test"
import {
  runFormattersForFile,
  clearFormatterCache,
  resolveFormatters,
  buildFormatterCommand,
  type FormatterClient,
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

  it("returns cached result on subsequent calls", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        prettier: {
          command: ["prettier", "--write", "$FILE"],
          extensions: [".ts"],
        },
      },
    })
    await resolveFormatters(client, "/project")

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(client.config.get).toHaveBeenCalledTimes(1)
    expect(result.get(".ts")).toHaveLength(1)
  })

  it("returns fresh result after clearFormatterCache", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        prettier: {
          command: ["prettier", "--write", "$FILE"],
          extensions: [".ts"],
        },
      },
    })
    await resolveFormatters(client, "/project")
    clearFormatterCache()

    //#when
    await resolveFormatters(client, "/project")

    //#then
    expect(client.config.get).toHaveBeenCalledTimes(2)
  })

  it("handles config.get failure gracefully", async () => {
    //#given
    const client: FormatterClient = {
      config: {
        get: mock(() => Promise.reject(new Error("network error"))),
      },
    }

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.size).toBe(0)
  })

  it("handles missing config data", async () => {
    //#given
    const client: FormatterClient = {
      config: {
        get: mock(() => Promise.resolve({ data: undefined })),
      },
    }

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.size).toBe(0)
  })

  it("merges formatter and experimental.hook.file_edited for same extension", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        prettier: {
          command: ["prettier", "--write", "$FILE"],
          extensions: [".ts"],
        },
      },
      experimental: {
        hook: {
          file_edited: {
            ".ts": [{ command: ["eslint", "--fix", "$FILE"] }],
          },
        },
      },
    })

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.get(".ts")).toHaveLength(2)
    expect(result.get(".ts")![0].command).toEqual(["prettier", "--write", "$FILE"])
    expect(result.get(".ts")![1].command).toEqual(["eslint", "--fix", "$FILE"])
  })

  it("defaults environment to empty object when not specified", async () => {
    //#given
    const client = createMockClient({
      experimental: {
        hook: {
          file_edited: {
            ".py": [{ command: ["black", "$FILE"] }],
          },
        },
      },
    })

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.get(".py")![0].environment).toEqual({})
  })

  it("preserves environment from formatter config", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        biome: {
          command: ["biome", "format", "$FILE"],
          extensions: [".ts"],
          environment: { BIOME_LOG: "debug" },
        },
      },
    })

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.get(".ts")![0].environment).toEqual({ BIOME_LOG: "debug" })
  })

  it("skips formatter=false config", async () => {
    //#given
    const client = createMockClient({
      formatter: false,
    })

    //#when
    const result = await resolveFormatters(client, "/project")

    //#then
    expect(result.size).toBe(0)
  })
})

describe("runFormattersForFile", () => {
  beforeEach(() => {
    clearFormatterCache()
  })

  it("skips files without extensions", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        prettier: {
          command: ["prettier", "--write", "$FILE"],
          extensions: [".ts"],
        },
      },
    })

    //#when
    await runFormattersForFile(client, "/project", "Makefile")

    //#then
    expect(client.config.get).not.toHaveBeenCalled()
  })

  it("skips when no matching formatters for extension", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        prettier: {
          command: ["prettier", "--write", "$FILE"],
          extensions: [".ts"],
        },
      },
    })

    //#when — run for a .go file, but only .ts formatters registered
    await runFormattersForFile(client, "/project", "/src/main.go")

    //#then — no error thrown
  })

  it("runs formatter for matching extension", async () => {
    //#given
    const client = createMockClient({
      formatter: {
        echo: {
          command: ["echo", "$FILE"],
          extensions: [".ts"],
        },
      },
    })

    //#when — echo is a safe no-op command
    await runFormattersForFile(client, "/tmp", "/tmp/test.ts")

    //#then — should complete without error
    expect(client.config.get).toHaveBeenCalledTimes(1)
  })
})
