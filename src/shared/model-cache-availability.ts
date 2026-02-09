import { existsSync } from "fs"
import { join } from "path"
import { getOpenCodeCacheDir } from "./data-path"
import { hasProviderModelsCache } from "./connected-providers-cache"

export function __resetModelCache(): void {}

export function isModelCacheAvailable(): boolean {
	if (hasProviderModelsCache()) {
		return true
	}
	const cacheFile = join(getOpenCodeCacheDir(), "models.json")
	return existsSync(cacheFile)
}
