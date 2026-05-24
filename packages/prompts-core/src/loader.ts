import { parseFrontmatter } from "@oh-my-opencode/utils"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { PromptNotFoundError, type LoadedPrompt, type LoadPromptInput } from "./types"

function hasErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false
  if (!("code" in error)) return false
  return error.code === code
}

export async function loadPrompt(input: LoadPromptInput): Promise<LoadedPrompt> {
  const resolvedPath = resolve(input.source, input.name, `${input.variant}.md`)
  let content: string

  try {
    content = await readFile(resolvedPath, "utf8")
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new PromptNotFoundError(`Prompt not found at ${resolvedPath}`)
    }
    throw error
  }

  const parsed = parseFrontmatter(content)
  let body = parsed.body

  for (const injection of input.inject ?? []) {
    body = body.replaceAll(injection.placeholder, injection.resolver())
  }

  return {
    body,
    frontmatter: parsed.data,
    resolvedPath,
  }
}
