// #12303 review LOW: a pairing waiting in `omo sync enable` must not publish its pin after another
// process (`omo logout`) discarded the keys it holds. The sync context's operation authority runs the
// pin write inside the credential lock, admitted only while the captured credential is still stored.
//
// #12945: "still stored" is the whole identity the token path compares (device id, both private keys,
// credentialGeneration), for the account the context records as well as for the pin write.

import { expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"

import { CredentialIdentityChanged } from "../../omo-opencode/src/cli/service-auth/keystore"
import { fakeApi, grant, memorySecrets, temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { signedInSyncContext } from "../sync-context"

const der = (key: { export(options: { format: "der"; type: "pkcs8" }): Buffer }) =>
  key.export({ format: "der", type: "pkcs8" }).toString("base64")
const privateKeys = {
  signingPrivateKey: der(generateKeyPairSync("ed25519").privateKey),
  sealingPrivateKey: der(generateKeyPairSync("x25519").privateKey),
}

type Stored = Record<string, unknown>
type Secrets = ReturnType<typeof memorySecrets>
type Change = (stored: Stored) => Stored

function storedCredential(secrets: Secrets): Stored {
  const raw = [...secrets.values.values()][0]
  if (raw === undefined) throw new Error("no credential is stored")
  return JSON.parse(raw) as Stored
}

/** Rewrites the raw stored secret, as a sign-in in another process would, and returns what it stored. */
function plant(secrets: Secrets, change: Change): Stored {
  const name = [...secrets.values.keys()][0]
  if (name === undefined) throw new Error("no credential is stored")
  const planted = change(storedCredential(secrets))
  secrets.values.set(name, JSON.stringify(planted))
  return planted
}

async function context(
  moments: {
    readonly beforeBuild?: (secrets: Secrets) => void
    readonly whileAccountIsFetched?: (secrets: Secrets) => void
    readonly onRequest?: (request: Request) => void
  } = {},
) {
  const secrets = memorySecrets()
  const api = fakeApi((request) => {
    moments.onRequest?.(request)
    if (new URL(request.url).pathname !== "/v1/me") return new Response(null, { status: 404 })
    moments.whileAccountIsFetched?.(secrets)
    return Response.json({ user: { id: "u" }, account: { id: "acct-fence" } })
  })
  const store = secrets.store(api)
  await store.write({ ...grant, ...privateKeys })
  moments.beforeBuild?.(secrets)
  const ctx = await signedInSyncContext({ env: { OMO_SERVICE_API_URL: api }, cwd: await temporaryHome(), store })
  return { ctx, store, secrets }
}

// The store mints a new generation whenever the device or a key changes, so a sign-in that differs from the
// captured one in exactly one identity field is planted in the raw secret.
const oneIdentityField: readonly (readonly [string, Change])[] = [
  ["device id", (stored) => ({ ...stored, device: { ...grant.device, id: "device-other" } })],
  [
    "signing private key",
    (stored) => ({ ...stored, signingPrivateKey: der(generateKeyPairSync("ed25519").privateKey) }),
  ],
  [
    "sealing private key",
    (stored) => ({ ...stored, sealingPrivateKey: der(generateKeyPairSync("x25519").privateKey) }),
  ],
  ["credentialGeneration", (stored) => ({ ...stored, credentialGeneration: "generation-other" })],
]
// Another process refreshing the tokens keeps the sign-in: no identity field moves.
const rotatedTokens: Change = (stored) => ({
  ...stored,
  accessToken: "rotated-access",
  refreshToken: "rotated-refresh",
})

test("#given a sync context #when its credential is still stored #then a pin write is admitted inside the credential lock", async () => {
  const { ctx } = await context()
  expect(await ctx.authority.boundary?.(() => "published")).toBe("published")
  expect(ctx.authority.signal.aborted).toBe(false)
})

test("#given a sync context #when another process logged out meanwhile #then no pin write is admitted and the operation is retired", async () => {
  const { ctx, store } = await context()
  await store.clear()
  let published = false
  await expect(
    ctx.authority.boundary?.(() => {
      published = true
    }),
  ).rejects.toThrow("no longer current")
  expect(published).toBe(false)
  expect(ctx.authority.signal.aborted).toBe(true)
  expect(() => ctx.authority.admit(() => undefined)).toThrow()
})

test("#given a sync context #when a different device signed in meanwhile #then no pin write is admitted", async () => {
  const { ctx, store } = await context()
  await store.write({ ...grant, ...privateKeys, device: { id: "device-other", name: "Other CLI" } })
  await expect(ctx.authority.boundary?.(() => undefined)).rejects.toThrow("no longer current")
})

for (const [field, change] of oneIdentityField) {
  test(`#given a sync context #when the stored sign-in differs from it only in the ${field} #then no pin write is admitted`, async () => {
    const { ctx, secrets } = await context()
    plant(secrets, change)
    let published = false
    await expect(
      ctx.authority.boundary?.(() => {
        published = true
      }),
    ).rejects.toThrow("no longer current")
    expect(published).toBe(false)
  })

  test(`#given a sign-in differing only in the ${field} replaced the stored one while the account was fetched #when the sync context is built #then the fetched account is not recorded on it`, async () => {
    let replacement: Stored | undefined
    const { secrets } = await context({
      whileAccountIsFetched: (secrets) => {
        replacement = plant(secrets, change)
      },
    })
    expect(replacement).toBeDefined()
    // Nothing was written over the replacement: it names no account.
    expect(storedCredential(secrets)).toEqual(replacement ?? {})
  })
}

test("#given another process refreshed the tokens while the account was fetched #when the sync context is built #then the account is recorded and a pin write is admitted", async () => {
  let refreshed: Stored | undefined
  const { ctx, secrets } = await context({
    whileAccountIsFetched: (secrets) => {
      refreshed = plant(secrets, rotatedTokens)
    },
  })
  expect(storedCredential(secrets)).toEqual({ ...refreshed, accountId: "acct-fence" })
  expect(await ctx.authority.boundary?.(() => "published")).toBe("published")
})

test("#given a sync context #when another process refreshed the tokens meanwhile #then a pin write is admitted", async () => {
  const { ctx, secrets } = await context()
  plant(secrets, rotatedTokens)
  expect(await ctx.authority.boundary?.(() => "published")).toBe("published")
})

test("#given a credential stored before generations existed #when the sync context records its account #then the generation that write mints does not retire the context", async () => {
  const { ctx, secrets } = await context({
    beforeBuild: (secrets) => {
      plant(secrets, ({ credentialGeneration: _minted, ...legacy }) => legacy)
    },
  })
  expect(storedCredential(secrets)).toMatchObject({ accountId: "acct-fence", credentialGeneration: expect.any(String) })
  expect(await ctx.authority.boundary?.(() => "published")).toBe("published")
})

// #13138 review L2: the same device and keys under another account is another sign-in.
test("#given a sync context #when the stored sign-in keeps its device and keys but names another account #then no pin write is admitted", async () => {
  const { ctx, secrets } = await context()
  plant(secrets, (stored) => ({ ...stored, accountId: "acct-other" }))
  let published = false
  await expect(
    ctx.authority.boundary?.(() => {
      published = true
    }),
  ).rejects.toThrow("no longer current")
  expect(published).toBe(false)
})

// #13138 review L1: a credential stored before generations existed gets its generation from the store's next
// write, and that write can be a token refresh instead of this context's own account write.
const beforeGenerations: Change = ({ credentialGeneration: _minted, ...stored }) => stored
const refreshMintsGeneration: Change = (stored) => ({
  ...rotatedTokens(stored),
  credentialGeneration: "generation-minted-by-refresh",
})

test("#given a credential stored before generations existed #when a token refresh mints its generation while the account is fetched #then the account is recorded and a pin write is admitted", async () => {
  let refreshed: Stored | undefined
  const { ctx, secrets } = await context({
    beforeBuild: (secrets) => {
      plant(secrets, beforeGenerations)
    },
    whileAccountIsFetched: (secrets) => {
      refreshed = plant(secrets, refreshMintsGeneration)
    },
  })
  expect(storedCredential(secrets)).toEqual({ ...refreshed, accountId: "acct-fence" })
  expect(await ctx.authority.boundary?.(() => "published")).toBe("published")
})

test("#given a context that took the generation a token refresh minted #when the stored sign-in later carries another generation #then no pin write is admitted", async () => {
  const { ctx, secrets } = await context({
    beforeBuild: (secrets) => {
      plant(secrets, beforeGenerations)
    },
    whileAccountIsFetched: (secrets) => {
      plant(secrets, refreshMintsGeneration)
    },
  })
  plant(secrets, (stored) => ({ ...stored, credentialGeneration: "generation-other" }))
  await expect(ctx.authority.boundary?.(() => undefined)).rejects.toThrow("no longer current")
})

// #13138 review L3: a request of this context carries its own sign-in's token or is not sent.
test("#given a sync context #when another sign-in replaced the stored one #then its account request is refused before it is sent", async () => {
  const paths: string[] = []
  const { ctx, secrets } = await context({ onRequest: (request) => paths.push(new URL(request.url).pathname) })
  plant(secrets, (stored) => ({
    ...stored,
    device: { ...grant.device, id: "device-other" },
    accessToken: "replacement-access",
  }))
  await expect(ctx.chain.state()).rejects.toBeInstanceOf(CredentialIdentityChanged)
  expect(paths).toEqual(["/v1/me"])
})
