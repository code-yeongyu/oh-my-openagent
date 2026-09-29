// The secret document a built-in adapter reads from the custody-checked credentials: a JSON object
// in the credentials file, in `<credentials_dir>/<platform file>`, or in the credentials env var
// (where a bare token string also works). Errors name where the document was, never its content.

import { join } from "node:path"
import { readFile } from "@oh-my-opencode/memory-core/fs"
import type { Credentials } from "./credentials"

export type CredentialDocument = { readonly [key: string]: unknown; readonly where: string }

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)

async function rawDocument(credentials: Credentials, dirFile: string, platform: string): Promise<{ raw: string; where: string }> {
  switch (credentials.kind) {
    case "file":
      return { raw: await readFile(credentials.path, "utf8"), where: "the credentials file" }
    case "dir":
      return { raw: await readFile(join(credentials.path, dirFile), "utf8"), where: `${dirFile} in the credentials directory` }
    case "env":
      return { raw: credentials.value, where: `env ${credentials.name}` }
    case "none":
      throw new Error(`a ${platform} surface needs credentials_file, credentials_dir or credentials_env`)
  }
}

export async function readCredentialDocument(credentials: Credentials, dirFile: string, platform: string): Promise<CredentialDocument> {
  const { raw, where } = await rawDocument(credentials, dirFile, platform)
  const text = raw.trim()
  if (!text.startsWith("{")) {
    if (text === "" || /\s/.test(text)) throw new Error(`${platform} credentials in ${where} are neither a JSON object nor a token`)
    return { token: text, where }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${platform} credentials in ${where} are not valid JSON`)
  }
  if (!isObject(parsed)) throw new Error(`${platform} credentials in ${where} are not a JSON object`)
  return { ...parsed, where }
}

export function stringField(document: CredentialDocument, key: string): string | undefined {
  const value = document[key]
  return typeof value === "string" && value !== "" ? value : undefined
}
