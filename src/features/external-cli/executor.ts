import type { ExternalCliProvider } from "../../config/schema"
import type {
  ExternalCliExecuteOptions,
  ExternalCliExecuteResult,
  ExternalCliProviderInterface,
} from "./types"
import { createProvider } from "./providers"

let cachedProvider: ExternalCliProviderInterface | null = null
let cachedProviderName: ExternalCliProvider | null = null

export function getProvider(name: ExternalCliProvider): ExternalCliProviderInterface {
  if (cachedProvider && cachedProviderName === name) {
    return cachedProvider
  }
  cachedProvider = createProvider(name)
  cachedProviderName = name
  return cachedProvider
}

export async function executeExternalCli(
  providerName: ExternalCliProvider,
  options: ExternalCliExecuteOptions
): Promise<ExternalCliExecuteResult> {
  const provider = getProvider(providerName)
  return provider.execute(options)
}

export async function isProviderAvailable(providerName: ExternalCliProvider): Promise<boolean> {
  const provider = getProvider(providerName)
  return provider.isAvailable()
}

export { CursorProvider } from "./providers"
