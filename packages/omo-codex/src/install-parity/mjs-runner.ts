import { Buffer } from "node:buffer"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export async function runMjsScript(script: string, input: JsonValue): Promise<unknown> {
  const encodedInput = Buffer.from(JSON.stringify(input), "utf8").toString("base64url")
  const proc = Bun.spawn([process.execPath, "--eval", script, encodedInput], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`mjs parity subprocess exited ${exitCode}: ${stderr}`)
  }
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return null
  return JSON.parse(trimmed)
}

export function expectString(value: unknown): string {
  if (typeof value === "string") return value
  throw new Error(`expected string mjs result, received ${typeof value}`)
}
