import * as dataPath from "./data-path"
import { createJsonFileCacheStore } from "./json-file-cache-store"
import {
  MODELS_DEV_SOURCE_URL,
  buildModelCapabilitiesSnapshotFromModelsDev,
  fetchModelCapabilitiesSnapshot,
} from "@oh-my-opencode/model-core"
import type { ModelCapabilitiesSnapshot } from "./model-capabilities"

export {
  MODELS_DEV_SOURCE_URL,
  buildModelCapabilitiesSnapshotFromModelsDev,
  fetchModelCapabilitiesSnapshot,
}

const MODEL_CAPABILITIES_CACHE_FILE = "model-capabilities.json"

export function createModelCapabilitiesCacheStore(
  getCacheDir: () => string = dataPath.getOmoOpenCodeCacheDir,
) {
  const snapshotCacheStore = createJsonFileCacheStore<ModelCapabilitiesSnapshot>({
    getCacheDir,
    filename: MODEL_CAPABILITIES_CACHE_FILE,
    logPrefix: "model-capabilities-cache",
    cacheLabel: "Cache",
    describe: (snapshot) => ({
      modelCount: Object.keys(snapshot.models).length,
      generatedAt: snapshot.generatedAt,
    }),
    serialize: (snapshot) => `${JSON.stringify(snapshot, null, 2)}\n`,
  })

  function readModelCapabilitiesCache(): ModelCapabilitiesSnapshot | null {
    return snapshotCacheStore.read()
  }

  function hasModelCapabilitiesCache(): boolean {
    return snapshotCacheStore.has()
  }

  function writeModelCapabilitiesCache(snapshot: ModelCapabilitiesSnapshot): void {
    snapshotCacheStore.write(snapshot)
  }

  async function refreshModelCapabilitiesCache(args: {
    sourceUrl?: string
    fetchImpl?: (input: string) => Promise<Response>
  } = {}): Promise<ModelCapabilitiesSnapshot> {
    const snapshot = await fetchModelCapabilitiesSnapshot(args)
    writeModelCapabilitiesCache(snapshot)
    return snapshot
  }

  return {
    readModelCapabilitiesCache,
    hasModelCapabilitiesCache,
    writeModelCapabilitiesCache,
    refreshModelCapabilitiesCache,
  }
}

const defaultModelCapabilitiesCacheStore = createModelCapabilitiesCacheStore(
  () => dataPath.getOmoOpenCodeCacheDir(),
)

export const {
  readModelCapabilitiesCache,
  hasModelCapabilitiesCache,
  writeModelCapabilitiesCache,
  refreshModelCapabilitiesCache,
} = defaultModelCapabilitiesCacheStore
