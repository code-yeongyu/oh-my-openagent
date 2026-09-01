import type { ReflectionSpawnArgs } from "./worker/spawn"

export type SandboxPolicy = "required" | "auto" | "off"

export interface SandboxTransform {
  (spawnArgs: ReflectionSpawnArgs): ReflectionSpawnArgs
  readonly wasSandboxed: boolean
  readonly warning?: string
}

export class SandboxUnavailableError extends Error {
  readonly platform: NodeJS.Platform

  constructor(platform: NodeJS.Platform, reason: string) {
    super(`required reflection sandbox unavailable on ${platform}: ${reason}`)
    this.name = "SandboxUnavailableError"
    this.platform = platform
  }
}
