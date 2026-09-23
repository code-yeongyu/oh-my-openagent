import { z } from "zod"

export const STANDALONE_PARITY_VERSION = 1

export const generatedMcpSchema = z.object({
  name: z.string().min(1),
  declaration: z.record(z.string(), z.unknown()),
})

export const standaloneParityManifestSchema = z.object({
  version: z.literal(STANDALONE_PARITY_VERSION),
  generatedAt: z.string().datetime(),
  skills: z.array(z.string()).readonly(),
  commands: z.array(z.string()).readonly(),
  mcps: z.array(generatedMcpSchema).readonly(),
  instructionsPath: z.literal("instructions.md"),
  routingPath: z.literal("routing.json"),
  files: z.record(z.string(), z.string()),
})

export type GeneratedMcp = z.infer<typeof generatedMcpSchema>
export type StandaloneParityManifest = z.infer<typeof standaloneParityManifestSchema>

export type GeneratedCommand = {
  readonly name: string
  readonly description: string
  readonly template: string
}

export type RoutingReport = {
  readonly routes: {
    readonly agents: Readonly<Record<string, string>>
    readonly categories: Readonly<Record<string, string>>
  }
  readonly optionalMisses: readonly string[]
}

export class StandaloneParityInputError extends Error {
  readonly name = "StandaloneParityInputError"

  constructor(readonly detail: string) {
    super(`standalone parity input rejected: ${detail}`)
  }
}

export class StandaloneParityVerificationError extends Error {
  readonly name = "StandaloneParityVerificationError"

  constructor(readonly detail: string) {
    super(`standalone parity verification failed: ${detail}`)
  }
}
