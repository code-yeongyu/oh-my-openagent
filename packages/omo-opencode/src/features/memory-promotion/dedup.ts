import { createHash } from "node:crypto"

export interface DedupEntry {
  memory_id: string
  source_ref: string
  promotion_origin: string
  content_hash: string
}

export interface DedupCheckResult {
  is_duplicate: boolean
  reason?: string
  matched_memory_id?: string
}

export function computeContentHash(content: string): string {
  const normalized = content.toLowerCase().replace(/\s+/g, " ").trim()
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16)
}

export interface DedupStore {
  findByProvenance(
    source_ref: string,
    promotion_origin: string,
  ): Promise<DedupEntry | undefined>
  findByContentHash(content_hash: string): Promise<DedupEntry | undefined>
  record(entry: DedupEntry): Promise<void>
}

export async function checkDedup(
  input: {
    source_ref: string
    promotion_origin: string
    raw_content: string
    memory_id: string
  },
  store: DedupStore,
): Promise<DedupCheckResult> {
  const existingByProvenance = await store.findByProvenance(
    input.source_ref,
    input.promotion_origin,
  )

  if (existingByProvenance) {
    return {
      is_duplicate: true,
      reason: `Same source (${input.source_ref} from ${input.promotion_origin}) already promoted`,
      matched_memory_id: existingByProvenance.memory_id,
    }
  }

  const content_hash = computeContentHash(input.raw_content)
  const existingByHash = await store.findByContentHash(content_hash)

  if (existingByHash) {
    return {
      is_duplicate: true,
      reason: `Identical content (hash: ${content_hash}) already exists`,
      matched_memory_id: existingByHash.memory_id,
    }
  }

  await store.record({
    memory_id: input.memory_id,
    source_ref: input.source_ref,
    promotion_origin: input.promotion_origin,
    content_hash,
  })

  return { is_duplicate: false }
}

export class InMemoryDedupStore implements DedupStore {
  private readonly byProvenance = new Map<string, DedupEntry>()
  private readonly byHash = new Map<string, DedupEntry>()

  async findByProvenance(
    source_ref: string,
    promotion_origin: string,
  ): Promise<DedupEntry | undefined> {
    return this.byProvenance.get(`${source_ref}:${promotion_origin}`)
  }

  async findByContentHash(content_hash: string): Promise<DedupEntry | undefined> {
    return this.byHash.get(content_hash)
  }

  async record(entry: DedupEntry): Promise<void> {
    this.byProvenance.set(`${entry.source_ref}:${entry.promotion_origin}`, entry)
    this.byHash.set(entry.content_hash, entry)
  }
}
