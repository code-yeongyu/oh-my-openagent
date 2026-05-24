import { parseFrontmatter } from "@oh-my-opencode/utils"
import { readFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import type { LoadedPrompt, LoadPromptInput, RuntimeInjection } from "./types"

export class PromptFileNotFoundError extends Error {
  readonly name = "PromptFileNotFoundError"

  constructor(
    readonly promptName: string,
    readonly variant: string,
    readonly filePath: string,
    options?: ErrorOptions
  ) {
    super(`Prompt file not found for ${promptName}/${variant}: ${filePath}`, options)
  }
}

export class PromptPathTraversalError extends Error {
  readonly name = "PromptPathTraversalError"

  constructor(
    readonly promptName: string,
    readonly variant: string
  ) {
    super(`Prompt path escapes source directory for ${promptName}/${variant}`)
  }
}

export async function loadPrompt<TFrontmatter = Record<string, unknown>>(
  input: LoadPromptInput
): Promise<LoadedPrompt<TFrontmatter>> {
  const filePath = resolvePromptFilePath(input.source.baseDir, input.name, input.variant)
  const content = await readPromptFile(input.name, input.variant, filePath)
  const parsed = parseFrontmatter<TFrontmatter>(content)
  const body = await applyRuntimeInjections(parsed.body, input.inject ?? [])

  return {
    frontmatter: parsed.data,
    body,
    hadFrontmatter: parsed.hadFrontmatter,
    parseError: parsed.parseError,
    filePath,
  }
}

function resolvePromptFilePath(baseDir: string, promptName: string, variant: string): string {
  const resolvedBaseDir = resolve(baseDir)
  const filePath = resolve(resolvedBaseDir, promptName, `${variant}.md`)
  const relativePath = relative(resolvedBaseDir, filePath)
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new PromptPathTraversalError(promptName, variant)
  }
  return filePath
}

async function readPromptFile(promptName: string, variant: string, filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if (error instanceof Error && getErrorCode(error) === "ENOENT") {
      throw new PromptFileNotFoundError(promptName, variant, filePath, { cause: error })
    }
    throw error
  }
}

async function applyRuntimeInjections(
  body: string,
  injections: readonly RuntimeInjection[]
): Promise<string> {
  let renderedBody = body
  for (const injection of injections) {
    renderedBody = renderedBody.replaceAll(injection.placeholder, await injection.resolver())
  }
  return renderedBody
}

function getErrorCode(error: Error): string | undefined {
  if (!("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
