import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"
import { ApiRefusal, type Credentials, SignInError } from "./protocol"

// #12281: `omo logout` discards the device's keys on every path, but a revoke the service did not confirm (offline,
// 5xx, an uncertain refresh) leaves the service device live, so the service never asks the account's members to
// rotate its sync principal out of the keyring. That revoke is owed. This non-secret file next to the signed-out
// marker lists each owed device; the next sign-in on this computer sends `DELETE /v1/devices/:id` with its own
// bearer, which revokes any device of the caller's account (204 also for one already revoked).
const owedSchema = z.object({ device: z.string().min(1), account: z.string().min(1).optional(), at: z.string() })
const fileSchema = z.object({ owed: z.array(owedSchema) })
type OwedRevoke = z.infer<typeof owedSchema>

export const owedRevokePath = (home: string, credential: string): string =>
  join(home, ".omo", "account-state", `${credential}.revoke-owed.json`)

export const accountOfCredentials = (credentials: Credentials): string | undefined =>
  credentials.accountId ?? credentials.owner?.accountId

// A missing, unreadable or malformed file owes nothing: the owe is a best-effort follow-up, never a sign-in gate.
async function readOwed(path: string): Promise<OwedRevoke[]> {
  const text = await readFile(path, "utf8").catch(() => null)
  if (text === null) return []
  try {
    const parsed = fileSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data.owed : []
  } catch {
    return []
  }
}

async function writeOwed(path: string, owed: readonly OwedRevoke[]): Promise<void> {
  if (owed.length === 0) return rm(path, { force: true })
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const staging = `${path}.${process.pid}.tmp`
  await writeFile(staging, JSON.stringify({ owed: [...owed] } satisfies z.infer<typeof fileSchema>), { mode: 0o600 })
  await rename(staging, path)
}

/** Records that `device`'s revoke is owed. Called under the credential lock, before its keys are discarded. */
export async function oweRevoke(path: string, device: string, account: string | undefined): Promise<void> {
  const owed = (await readOwed(path)).filter((entry) => entry.device !== device)
  await writeOwed(path, [
    ...owed,
    { device, ...(account === undefined ? {} : { account }), at: new Date().toISOString() },
  ])
}

/**
 * Sends every owed revoke this fresh sign-in can settle. An owe for another account waits for a sign-in to that
 * account; one that fails (offline, 5xx) waits for the next sign-in. `not_found` settles it only when both sides
 * name the same account, because the service answers `not_found` for a device of another account too.
 */
export async function settleOwedRevokes(options: {
  readonly path: string
  readonly signedIn: Credentials
  readonly request: (path: string, init: RequestInit) => Promise<unknown>
  readonly locked: <T>(action: () => Promise<T>) => Promise<T>
}): Promise<void> {
  const { path, signedIn } = options
  const account = accountOfCredentials(signedIn)
  const owed = await readOwed(path)
  if (owed.length === 0) return
  const settled = new Set<string>([signedIn.device.id])
  for (const entry of owed) {
    if (entry.device === signedIn.device.id) continue
    if (entry.account !== undefined && account !== undefined && entry.account !== account) continue
    try {
      await options.request(`/v1/devices/${encodeURIComponent(entry.device)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${signedIn.accessToken}` },
      })
      settled.add(entry.device)
    } catch (error) {
      if (!(error instanceof SignInError)) throw error
      if (
        error instanceof ApiRefusal &&
        error.code === "not_found" &&
        entry.account !== undefined &&
        entry.account === account
      )
        settled.add(entry.device)
    }
  }
  await options.locked(async () => {
    const current = await readOwed(path)
    if (current.some((entry) => settled.has(entry.device)))
      await writeOwed(
        path,
        current.filter((entry) => !settled.has(entry.device)),
      )
  })
}
