export interface ProviderMappingEntry {
  canonical_id: string
  provider_name: string
  provider_external_id: string
  created_at: string
}

export interface ProviderMappingDeps {
  upsertMapping(entry: ProviderMappingEntry): Promise<void>
  getByCanonicalId(canonical_id: string, provider_name: string): Promise<string | undefined>
  getByExternalId(provider_external_id: string, provider_name: string): Promise<string | undefined>
}

export class ProviderMappingService {
  constructor(private readonly deps: ProviderMappingDeps) {}

  async recordSync(canonical_id: string, provider_name: string, provider_external_id: string): Promise<void> {
    await this.deps.upsertMapping({
      canonical_id,
      provider_name,
      provider_external_id,
      created_at: new Date().toISOString(),
    })
  }

  async getExternalId(canonical_id: string, provider_name: string): Promise<string | undefined> {
    return this.deps.getByCanonicalId(canonical_id, provider_name)
  }

  async getCanonicalId(provider_external_id: string, provider_name: string): Promise<string | undefined> {
    return this.deps.getByExternalId(provider_external_id, provider_name)
  }
}
