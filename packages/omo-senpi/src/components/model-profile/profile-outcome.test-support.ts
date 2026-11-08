import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"

export interface RecordedEntry {
  readonly customType: string
  readonly data: unknown
  readonly options: { readonly startupBookkeeping?: boolean } | undefined
}

export class ProfileExtensionAPI extends FakeExtensionAPI {
  readonly entries: RecordedEntry[] = []

  appendEntry(customType: string, data?: unknown, options?: { readonly startupBookkeeping?: boolean }): void {
    this.entries.push({ customType, data, options })
  }
}

export function recordedOutcome(pi: ProfileExtensionAPI, index = 0): Record<string, unknown> | undefined {
  const entry = pi.entries[index]
  if (entry === undefined) return undefined
  return typeof entry.data === "object" && entry.data !== null
    ? { customType: entry.customType, ...entry.data }
    : { customType: entry.customType }
}
