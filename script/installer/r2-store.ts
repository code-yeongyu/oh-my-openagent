import { MirrorPlanError } from "./mirror-plan"
import type { R2Credentials } from "./r2-signed-put"

export interface R2Store {
  exists(key: string): Promise<boolean>
  stream(key: string): ReadableStream<Uint8Array>
  readText(key: string): Promise<string | null>
  write(key: string, body: string, contentType: string): Promise<void>
  listReleaseVersions(): Promise<string[]>
  deletePrefix(prefix: string): Promise<void>
  countObjects(prefix: string): Promise<number>
}

/** Every key is relative to `prefix`; a dry run gets a scratch prefix so it can never touch real objects. */
export function createR2Store(credentials: R2Credentials, prefix: string): R2Store {
  const client = new Bun.S3Client({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    bucket: credentials.bucket,
    endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
    region: "auto",
  })
  const full = (key: string) => `${prefix}${key}`

  async function listKeys(under: string): Promise<string[]> {
    const keys: string[] = []
    let token: string | undefined
    do {
      const page = await client.list({ prefix: full(under), maxKeys: 1000, ...(token ? { continuationToken: token } : {}) })
      for (const entry of page.contents ?? []) keys.push(entry.key)
      token = page.isTruncated ? page.nextContinuationToken : undefined
    } while (token)
    return keys
  }

  return {
    exists: (key) => client.exists(full(key)),
    stream: (key) => client.file(full(key)).stream(),
    async readText(key) {
      return (await client.exists(full(key))) ? client.file(full(key)).text() : null
    },
    async write(key, body, contentType) {
      await client.write(full(key), body, { type: contentType })
    },
    async listReleaseVersions() {
      const versions = new Set<string>()
      for (const key of await listKeys("releases/")) {
        const match = /releases\/v([^/]+)\//.exec(key)
        if (match?.[1] !== undefined) versions.add(match[1])
      }
      return [...versions]
    },
    async deletePrefix(under) {
      if (full(under) === "" || !full(under).endsWith("/")) {
        throw new MirrorPlanError(`refusing to delete the unbounded prefix "${full(under)}"`)
      }
      for (const key of await listKeys(under)) await client.delete(key)
    },
    async countObjects(under) {
      return (await listKeys(under)).length
    },
  }
}
