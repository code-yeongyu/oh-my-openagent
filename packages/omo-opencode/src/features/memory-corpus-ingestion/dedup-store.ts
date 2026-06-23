export interface DedupEntry {
  content_sha256: string
  doc_id: string
  source_file: string
  ingested_at: string
}

export interface DedupStore {
  has(sha256: string): Promise<boolean>
  record(entry: DedupEntry): Promise<void>
  getByHash(sha256: string): Promise<DedupEntry | undefined>
  getByFile(source_file: string): Promise<DedupEntry | undefined>
  clear(): Promise<void>
}

export class InMemoryDedupStore implements DedupStore {
  private readonly byHash = new Map<string, DedupEntry>()
  private readonly byFile = new Map<string, DedupEntry>()

  async has(sha256: string): Promise<boolean> {
    return this.byHash.has(sha256)
  }

  async record(entry: DedupEntry): Promise<void> {
    this.byHash.set(entry.content_sha256, entry)
    this.byFile.set(entry.source_file, entry)
  }

  async getByHash(sha256: string): Promise<DedupEntry | undefined> {
    return this.byHash.get(sha256)
  }

  async getByFile(source_file: string): Promise<DedupEntry | undefined> {
    return this.byFile.get(source_file)
  }

  async clear(): Promise<void> {
    this.byHash.clear()
    this.byFile.clear()
  }
}
