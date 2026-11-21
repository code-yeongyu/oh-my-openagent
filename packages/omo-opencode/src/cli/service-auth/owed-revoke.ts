import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { syncRequestHeaders } from "@oh-my-opencode/memory-core/sync-capabilities"
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
/** An owe that names no account and that no sign-in here lists is given up after this, and the user is told. */
const OWED_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

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
  await writeFile(staging, JSON.stringify({ owed: [...owed] } satisfies z.infer<typeof fileSchema>), { mode: 0o600 })
  await rename(staging, path)
}

/**
 * Records that `device`'s revoke is owed. Called under the credential lock, before its keys are discarded. Returns how
 * many of the oldest owes were dropped to keep the file bounded; the caller reports them.
 */
export async function oweRevoke(path: string, device: string, account: string | undefined): Promise<number> {
  const owed = [
    ...(await readOwed(path)).filter((entry) => entry.device !== device),
    { device, ...(account === undefined ? {} : { account }), at: new Date().toISOString() },
  ]
  await writeOwed(path, owed.slice(-MAX_OWED))
  return Math.max(0, owed.length - MAX_OWED)
}

type Listed = z.infer<typeof listedSchema>["devices"][number]

// What a fresh sign-in does with one owe, judged from its own account's device list. A device the list does not hold
// belongs to another account (kept for a sign-in there) unless the owe names this account (gone: settled). An owe only
// ever comes from an omo CLI logout, so it can only name a CLI device of this computer's platform; one naming the
// desktop app's device, the caller itself, or another platform is not this computer's sign-out: dropped unsent.
// (Browsers are listed apart, in `browsers`, so an owe naming one is never in `devices`.)
// An owe that names no account and that no sign-in lists can never be judged; past its lifetime it expires (reported).
function judge(
  entry: OwedRevoke,
  listed: Listed | undefined,
  account: string | undefined,
): "send" | "keep" | "drop" | "expire" {
  if (listed === undefined) {
    if (entry.account !== undefined) return entry.account === account ? "drop" : "keep"
    return Date.now() - Date.parse(entry.at) > OWED_LIFETIME_MS ? "expire" : "keep"
  }
  if (listed.current || listed.kind !== "cli" || listed.platform !== devicePlatform()) return "drop"
  return listed.revokedAt === null ? "send" : "drop"
}

// A refusal that can pass: no answer, a 5xx, or rate limiting. Anything else the service says is lasting.
const transient = (error: SignInError): boolean =>
  !(error instanceof ApiRefusal) || error.status >= 500 || error.status === 429

export type OwedRevokeOutcome = {
  /** Owes due here that could not be sent now (no answer, 5xx, 429); kept for the next sign-in. */
  readonly unsent: number
  /** The codes of lasting refusals; those owes are dropped, and only the Devices page can remove the device. */
  readonly refused: readonly string[]
  /** Owes given up past their lifetime; only the Devices page can remove those devices. */
  readonly expired: number
}

/**
 * Sends the owed revokes this fresh sign-in can settle and forgets the settled ones. Anything that is not a service
 * answer (the list read, a file write, an abort) throws, and the caller reports it: the credential is already stored.
 */
export async function settleOwedRevokes(options: {
  readonly path: string
  readonly signedIn: Credentials
  readonly request: (path: string, init: RequestInit) => Promise<unknown>
  readonly locked: <T>(action: () => Promise<T>) => Promise<T>
}): Promise<OwedRevokeOutcome> {
  const { path, signedIn } = options
  const owed = await readOwed(path)
  if (owed.length === 0) return { unsent: 0, refused: [], expired: 0 }
  const headers = syncRequestHeaders(signedIn.accessToken)
  const listed = parseReply(listedSchema, await options.request("/v1/devices", { headers })).devices
  const account = accountOfCredentials(signedIn)
  const settled = new Set<string>()
  let unsent = 0
  let expired = 0
  const refused: string[] = []
  for (const entry of owed) {
    const verdict = judge(
      entry,
      listed.find((device) => device.id === entry.device),
      account,
    )
    if (verdict === "drop" || verdict === "expire") settled.add(entry.device)
    if (verdict === "expire") expired++
    if (verdict !== "send") continue
    try {
      await options.request(`/v1/devices/${encodeURIComponent(entry.device)}`, {
        method: "DELETE",
        headers,
      })
      settled.add(entry.device)
    } catch (error) {
      if (!(error instanceof SignInError)) throw error
      if (transient(error)) {
        unsent++
        continue
      }
      settled.add(entry.device)
      // The list just showed the device in this account, so not_found means it is gone since: nothing to report.
      if (!(error instanceof ApiRefusal && error.code === "not_found"))
        refused.push(error instanceof ApiRefusal ? error.code : "refused")
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
  return { unsent, refused, expired }
}
