import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"
import { devicePlatform } from "./device-name"
import { ApiRefusal, type Credentials, nonempty, parseReply, SignInError } from "./protocol"

// #12281: `omo logout` discards the device's keys on every path, but a revoke the service did not confirm (offline,
// 5xx, an uncertain refresh) leaves the service device live, so the service never asks the account's members to
// rotate its sync principal out of the keyring. That revoke is owed. This non-secret file next to the signed-out
// marker lists each owed device; a later sign-in on this computer revokes it with its own bearer. While the service
// holds this computer to one device (machine identity), that sign-in is refused until the device is removed on the
// Devices page, so the logout advice stays the Devices page and the sign-in only settles what is left.
const owedSchema = z.object({ device: z.string().min(1), account: z.string().min(1).optional(), at: z.string() })
const fileSchema = z.object({ owed: z.array(owedSchema) })
type OwedRevoke = z.infer<typeof owedSchema>
/** Each unconfirmed logout adds one; the oldest go first past this, so the file stays bounded. */
const MAX_OWED = 20

const listedSchema = z.object({
  devices: z.array(
    z.object({
      id: nonempty,
      kind: z.string(),
      platform: z.string(),
      current: z.boolean(),
      revokedAt: z.string().nullable(),
    }),
  ),
})

export const owedRevokePath = (home: string, credential: string): string =>
  join(home, ".omo", "account-state", `${credential}.revoke-owed.json`)

/** A sign-in's account: the owner record a grant carries, then the account `omo sync` stamped. */
export const accountOfCredentials = (credentials: Credentials): string | undefined =>
  credentials.owner?.accountId ?? credentials.accountId

// A missing or malformed file owes nothing: a revoke that cannot be read back is one the Devices page still covers.
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
  await writeFile(staging, JSON.stringify({ owed: owed.slice(-MAX_OWED) } satisfies z.infer<typeof fileSchema>), {
    mode: 0o600,
  })
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

type Listed = z.infer<typeof listedSchema>["devices"][number]

// What a fresh sign-in does with one owe, judged from its own account's device list. A device the list does not hold
// belongs to another account (kept for a sign-in there) unless the owe names this account (gone: settled). An owe can
// only ever name a machine device of this computer's platform; one naming a browser, the caller itself, or another
// platform is not this computer's sign-out, so it is dropped unsent.
function judge(entry: OwedRevoke, listed: Listed | undefined, account: string | undefined): "send" | "keep" | "drop" {
  if (listed === undefined) return entry.account !== undefined && entry.account === account ? "drop" : "keep"
  if (listed.current || listed.kind === "browser" || listed.platform !== devicePlatform()) return "drop"
  return listed.revokedAt === null ? "send" : "drop"
}

/**
 * Sends the owed revokes this fresh sign-in can settle and forgets the settled ones. Returns how many were due here
 * but could not be sent (offline, 5xx); those wait for the next sign-in. Anything else (the list read, a file write,
 * an abort) throws, and the caller reports it: the credential is already stored.
 */
export async function settleOwedRevokes(options: {
  readonly path: string
  readonly signedIn: Credentials
  readonly request: (path: string, init: RequestInit) => Promise<unknown>
  readonly locked: <T>(action: () => Promise<T>) => Promise<T>
}): Promise<number> {
  const { path, signedIn } = options
  const owed = await readOwed(path)
  if (owed.length === 0) return 0
  const authorization = { authorization: `Bearer ${signedIn.accessToken}` }
  const listed = parseReply(listedSchema, await options.request("/v1/devices", { headers: authorization })).devices
  const account = accountOfCredentials(signedIn)
  const settled = new Set<string>()
  let unsent = 0
  for (const entry of owed) {
    const verdict = judge(
      entry,
      listed.find((device) => device.id === entry.device),
      account,
    )
    if (verdict === "drop") settled.add(entry.device)
    if (verdict !== "send") continue
    try {
      await options.request(`/v1/devices/${encodeURIComponent(entry.device)}`, {
        method: "DELETE",
        headers: authorization,
      })
      settled.add(entry.device)
    } catch (error) {
      if (!(error instanceof SignInError)) throw error
      // The list just showed the device in this account, so not_found means it is gone since.
      if (error instanceof ApiRefusal && error.code === "not_found") settled.add(entry.device)
      else unsent++
    }
  }
  if (settled.size > 0)
    await options.locked(async () => {
      const current = await readOwed(path)
      await writeOwed(
        path,
        current.filter((entry) => !settled.has(entry.device)),
      )
    })
  return unsent
}
