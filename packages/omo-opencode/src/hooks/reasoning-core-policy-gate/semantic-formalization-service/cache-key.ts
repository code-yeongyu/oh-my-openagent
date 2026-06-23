type CacheVersions = {
  modelId: string
  modelVersion?: string
  promptVersion: string
  schemaVersion: number
  mode: "permissive" | "strict"
}

export type CacheKeyGenerator = {
  generate(request: unknown, versions: CacheVersions): string
}

function sortJsonKeys(value: unknown): string {
  return JSON.stringify(value, (_, currentValue) => {
    if (currentValue === null || typeof currentValue !== "object" || Array.isArray(currentValue)) {
      return currentValue
    }

    return Object.fromEntries(
      Object.entries(currentValue as Record<string, unknown>).sort(([leftKey], [rightKey]) =>
        leftKey.localeCompare(rightKey),
      ),
    )
  })
}

export function createCacheKeyGenerator(): CacheKeyGenerator {
  return {
    generate(request, versions) {
      const composite = [
        sortJsonKeys(request),
        versions.modelId,
        versions.modelVersion ?? "",
        versions.promptVersion,
        String(versions.schemaVersion),
        versions.mode,
      ].join("|")

      const hasher = new Bun.CryptoHasher("sha256")
      hasher.update(composite)
      return hasher.digest("hex")
    },
  }
}
