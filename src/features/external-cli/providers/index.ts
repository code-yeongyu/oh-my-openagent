import type { ExternalCliProvider } from "../../../config/schema"
import type { ExternalCliProviderInterface } from "../types"
import { CursorProvider } from "./cursor"

const providers: Record<ExternalCliProvider, () => ExternalCliProviderInterface> = {
  cursor: () => new CursorProvider(),
}

export function createProvider(name: ExternalCliProvider): ExternalCliProviderInterface {
  const factory = providers[name]
  if (!factory) {
    throw new Error(`Unknown external CLI provider: ${name}`)
  }
  return factory()
}

export { CursorProvider }
