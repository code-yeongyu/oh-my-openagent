import { describe, expect, test } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadPrompt, loadPromptSync, PromptFileNotFoundError, PromptPathTraversalError } from "./loader"
import type { BundledPromptSource, PromptSource } from "./types"

const fixtureSource: PromptSource = {
  baseDir: join(dirname(fileURLToPath(import.meta.url)), "__test_fixtures__"),
}

const bundledSource: BundledPromptSource = {
  kind: "bundled",
  content: "Bundled prompt body with {A}, {B}, and {C}.\n",
  filePath: "packages/prompts-core/prompts/test/default.md",
}

class ResolverFailureError extends Error {
  readonly name = "ResolverFailureError"
}

class ExpectedErrorMissingError extends Error {
  readonly name = "ExpectedErrorMissingError"
}

describe("loadPrompt", () => {
  test("#given markdown fixture #then returns markdown body verbatim", async () => {
    const prompt = await loadPrompt({ source: fixtureSource, name: "test-prompt", variant: "default" })

    expect(prompt.body).toBe("Default prompt body with {X}.\nSecond line remains verbatim.\n")
  })

  test("#given frontmatter fixture #then returns parsed frontmatter", async () => {
    const prompt = await loadPrompt<{ readonly title: string; readonly enabled: boolean }>({
      source: fixtureSource,
      name: "test-prompt",
      variant: "default",
    })

    expect(prompt.frontmatter.title).toBe("Test Prompt")
    expect(prompt.frontmatter.enabled).toBe(true)
  })

  test("#given empty frontmatter #then parses without crashing", async () => {
    const prompt = await loadPrompt({ source: fixtureSource, name: "test-prompt", variant: "gpt" })

    expect(prompt.frontmatter).toEqual({})
    expect(prompt.body).toBe("GPT prompt body with {A} and {B}.\n")
  })

  test("#given missing file #then error mentions prompt name and variant", async () => {
    const error = await captureError(() =>
      loadPrompt({ source: fixtureSource, name: "test-prompt", variant: "missing" })
    )

    expect(error).toBeInstanceOf(PromptFileNotFoundError)
    expect(expectError(error).message).toContain("test-prompt/missing")
  })

  test("#given prompt name escapes source directory #then rejects path traversal", async () => {
    const error = await captureError(() =>
      loadPrompt({ source: fixtureSource, name: "../test-prompt", variant: "default" })
    )

    expect(error).toBeInstanceOf(PromptPathTraversalError)
  })

  test("#given variant escapes source directory #then rejects path traversal", async () => {
    const error = await captureError(() =>
      loadPrompt({ source: fixtureSource, name: "test-prompt", variant: "../../outside" })
    )

    expect(error).toBeInstanceOf(PromptPathTraversalError)
  })

  test("#given runtime injection #then replaces placeholder in body", async () => {
    const prompt = await loadPrompt({
      source: fixtureSource,
      name: "test-prompt",
      variant: "default",
      inject: [{ placeholder: "{X}", resolver: () => "Y" }],
    })

    expect(prompt.body).toBe("Default prompt body with Y.\nSecond line remains verbatim.\n")
  })

  test("#given multiple runtime injections #then applies all and ignores absent placeholders", async () => {
    const prompt = await loadPrompt({
      source: fixtureSource,
      name: "test-prompt",
      variant: "gpt",
      inject: [
        { placeholder: "{A}", resolver: () => "Alpha" },
        { placeholder: "{B}", resolver: () => "Beta" },
        { placeholder: "{ABSENT}", resolver: () => "No-op" },
      ],
    })

    expect(prompt.body).toBe("GPT prompt body with Alpha and Beta.\n")
  })

  test("#given bundled prompt source #then returns synchronously with multiple injections", () => {
    const prompt = loadPrompt({
      source: bundledSource,
      name: "test-prompt",
      variant: "default",
      inject: [
        { placeholder: "{A}", resolver: () => "Alpha" },
        { placeholder: "{B}", resolver: () => "Beta" },
        { placeholder: "{C}", resolver: () => "Gamma" },
      ],
    })

    expect(prompt.body).toBe("Bundled prompt body with Alpha, Beta, and Gamma.\n")
    expect(prompt.filePath).toBe("packages/prompts-core/prompts/test/default.md")
  })

  test("#given bundled prompt source #when using sync loader #then returns synchronously", () => {
    const prompt = loadPromptSync({
      source: bundledSource,
      name: "test-prompt",
      variant: "default",
      inject: [{ placeholder: "{A}", resolver: () => "Alpha" }],
    })

    expect(prompt.body).toBe("Bundled prompt body with Alpha, {B}, and {C}.\n")
    expect(prompt.filePath).toBe("packages/prompts-core/prompts/test/default.md")
  })

  test("#given injection resolver throws #then propagates the error", async () => {
    const error = await captureError(() =>
      loadPrompt({
        source: fixtureSource,
        name: "test-prompt",
        variant: "default",
        inject: [
          {
            placeholder: "{X}",
            resolver: () => {
              throw new ResolverFailureError("resolver failed")
            },
          },
        ],
      })
    )

    expect(error).toBeInstanceOf(ResolverFailureError)
  })
})

async function captureError(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation()
    return undefined
  } catch (error) {
    return error
  }
}

function expectError(error: unknown): Error {
  if (error instanceof Error) return error
  throw new ExpectedErrorMissingError("Expected operation to throw an Error instance")
}
