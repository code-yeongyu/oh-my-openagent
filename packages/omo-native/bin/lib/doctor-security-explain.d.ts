// Types for doctor-security-explain.js. The OpenCode edition's `doctor` runner imports this module
// across the package boundary (the same shape omo-senpi uses for setup-stream.js), and TypeScript
// needs the declaration because omo-ai ships the implementation as plain JS.

export type SecurityExplainContext = {
  readonly home: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly agentDir: string
  readonly omoHome: string
}

export type SecurityExplainSection = {
  readonly id: string
  readonly setting: string
  /** The roadmap PR that replaces this section's pending marker with live state. */
  readonly pr: string
  readonly describe: (context: SecurityExplainContext) => string[]
}

export type SecurityExplainOptions = {
  readonly home?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly agentDir?: string
}

export const PENDING_PREFIX: string

export const SECURITY_EXPLAIN_SECTIONS: readonly SecurityExplainSection[]

export function runSecurityExplain(overrides?: SecurityExplainOptions): string[]