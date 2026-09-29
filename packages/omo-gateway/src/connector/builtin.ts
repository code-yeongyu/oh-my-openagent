// The adapter each platform gets when `omo gateway connect` has no `--adapter-module`. Each entry is
// a lazy import, so connecting one surface never loads another platform's adapter.

import type { Platform } from "../adapter/contract"
import type { AdapterFactory } from "./cli"

const BUILTIN = new Map<Platform, () => Promise<AdapterFactory>>([
  ["discord", async () => (await import("../adapters/discord/connect")).createAdapter],
  ["telegram", async () => (await import("../adapters/telegram/connect")).createAdapter],
])

export function hasBuiltinAdapter(platform: Platform): boolean {
  return BUILTIN.has(platform)
}

export async function builtinAdapterFactory(platform: Platform): Promise<AdapterFactory> {
  const load = BUILTIN.get(platform)
  if (load === undefined) throw new Error(`no built-in ${platform} adapter`)
  return load()
}
