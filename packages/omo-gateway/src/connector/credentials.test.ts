import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CredentialsRefused, resolveCredentials } from "./credentials"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function home(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-gateway-creds-"))
  roots.push(root)
  return root
}

function credsFile(at: string, mode: number): string {
  const path = join(at, "creds.json")
  writeFileSync(path, '{"token":"dummy"}')
  chmodSync(path, mode)
  return path
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof CredentialsRefused) return error.message
    throw error
  }
  throw new Error("expected a CredentialsRefused")
}

describe("credential custody", () => {
  test("#given a 0600 or 0400 credentials file #when resolved #then it is accepted", async () => {
    // given
    const at = home()
    const path = credsFile(at, 0o600)

    // when / then
    expect(await resolveCredentials({ platform: "slack", credentials_file: path }, { env: {}, home: at })).toEqual({ kind: "file", path })
    chmodSync(path, 0o400)
    expect((await resolveCredentials({ platform: "slack", credentials_file: path }, { env: {}, home: at })).kind).toBe("file")
  })

  test("#given a group-readable credentials file under ~ #when resolved #then it is refused naming ~ path and mode", async () => {
    // given
    const at = home()
    credsFile(at, 0o644)

    // when
    const text = await refusal(resolveCredentials({ platform: "slack", credentials_file: "~/creds.json" }, { env: {}, home: at }))

    // then
    expect(text).toBe("credentials must be 0600: ~/creds.json is 0644")
  })

  test("#given a credentials directory #when it or a file in it is open to others #then it is refused", async () => {
    // given
    const at = home()
    const dir = join(at, "messenger")
    mkdirSync(dir)
    const file = credsFile(dir, 0o600)

    // when / then
    chmodSync(dir, 0o755)
    expect(await refusal(resolveCredentials({ platform: "slack", credentials_dir: dir }, { env: {}, home: at }))).toBe(
      "credentials directory must be 0700: ~/messenger is 0755",
    )
    chmodSync(dir, 0o700)
    chmodSync(file, 0o640)
    expect(await refusal(resolveCredentials({ platform: "slack", credentials_dir: dir }, { env: {}, home: at }))).toBe(
      "credentials must be 0600: ~/messenger/creds.json is 0640",
    )
    chmodSync(file, 0o600)
    expect((await resolveCredentials({ platform: "slack", credentials_dir: dir }, { env: {}, home: at })).kind).toBe("dir")
  })

  test("#given a missing file or unset env #when resolved #then it is refused without any secret in the text", async () => {
    // given
    const at = home()

    // when / then
    expect(await refusal(resolveCredentials({ platform: "slack", credentials_file: join(at, "gone.json") }, { env: {}, home: at }))).toBe(
      "credentials file not found: ~/gone.json",
    )
    expect(await refusal(resolveCredentials({ platform: "telegram", credentials_env: "QA_TOKEN" }, { env: {}, home: at }))).toBe(
      "credentials env QA_TOKEN is not set",
    )
    expect(await resolveCredentials({ platform: "telegram", credentials_env: "QA_TOKEN" }, { env: { QA_TOKEN: "dummy" }, home: at })).toEqual({
      kind: "env",
      name: "QA_TOKEN",
      value: "dummy",
    })
    expect(await resolveCredentials({ platform: "slack" }, { env: {}, home: at })).toEqual({ kind: "none" })
  })
})
