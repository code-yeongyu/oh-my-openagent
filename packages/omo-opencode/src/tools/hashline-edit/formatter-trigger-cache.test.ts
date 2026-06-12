import { beforeEach, describe, expect, it, mock } from "bun:test"

import { clearFormatterCache, resolveFormatters, type FormatterClient } from "./formatter-trigger"

function createDirectoryAwareClient(
  resolveConfig: (directory: string) => Promise<Record<string, unknown> | undefined>,
): FormatterClient {
  return {
    config: {
      get: mock(async ({ query }: { query?: { directory?: string } } = {}) => ({
        data: await resolveConfig(query?.directory ?? ""),
      })),
    },
  }
}

describe("resolveFormatters cache behavior", () => {
  beforeEach(() => {
    clearFormatterCache()
  })

  it("caches formatter resolution per directory", async () => {
    //#given
    const client = createDirectoryAwareClient(async (directory) => {
      if (directory === "/project-a") {
        return {
          formatter: {
            prettier: {
              command: ["prettier", "--write", "$FILE"],
              extensions: [".ts"],
            },
          },
        }
      }

      return {
        formatter: {
          biome: {
            command: ["biome", "format", "$FILE"],
            extensions: [".ts"],
          },
        },
      }
    })

    //#when
    const firstProjectAResult = await resolveFormatters(client, "/project-a")
    const projectBResult = await resolveFormatters(client, "/project-b")
    const secondProjectAResult = await resolveFormatters(client, "/project-a")

    //#then
    expect(client.config.get).toHaveBeenCalledTimes(2)
    expect(firstProjectAResult.get(".ts")?.[0]?.command).toEqual(["prettier", "--write", "$FILE"])
    expect(projectBResult.get(".ts")?.[0]?.command).toEqual(["biome", "format", "$FILE"])
    expect(secondProjectAResult).toBe(firstProjectAResult)
  })

  it("does not cache transient config fetch failures", async () => {
    //#given
    const get = mock(async () => ({
      data: {
        formatter: {
          prettier: {
            command: ["prettier", "--write", "$FILE"],
            extensions: [".ts"],
          },
        },
      },
    }))

    get.mockImplementationOnce(async () => {
      throw new Error("network error")
    })

    const client: FormatterClient = {
      config: { get },
    }

    //#when
    const firstResult = await resolveFormatters(client, "/project-a")
    const secondResult = await resolveFormatters(client, "/project-a")

    //#then
    expect(get).toHaveBeenCalledTimes(2)
    expect(firstResult.size).toBe(0)
    expect(secondResult.get(".ts")?.[0]?.command).toEqual(["prettier", "--write", "$FILE"])
  })

  it("does not cache missing config data", async () => {
    //#given
    let callCount = 0
    const client = createDirectoryAwareClient(async () => {
      callCount += 1
      if (callCount === 1) {
        return undefined
      }

      return {
        formatter: {
          prettier: {
            command: ["prettier", "--write", "$FILE"],
            extensions: [".ts"],
          },
        },
      }
    })

    //#when
    const firstResult = await resolveFormatters(client, "/project-a")
    const secondResult = await resolveFormatters(client, "/project-a")

    //#then
    expect(client.config.get).toHaveBeenCalledTimes(2)
    expect(firstResult.size).toBe(0)
    expect(secondResult.get(".ts")?.[0]?.command).toEqual(["prettier", "--write", "$FILE"])
  })
})
