export type ParityStep = { readonly id: string; readonly tool: string; readonly arguments: Record<string, unknown> }
export type ParityResult = { readonly isError: boolean; readonly text: string }
export type ParityRun = {
  readonly tools: readonly string[]
  readonly results: Record<string, ParityResult>
  readonly doctor: readonly string[]
  readonly setup: readonly string[]
  readonly extensionFailures: readonly string[]
  readonly exitCodes: { readonly session: number | null; readonly doctor: number | null; readonly setup: number | null }
}

export const PARITY_STEPS: readonly ParityStep[]
export const DOCTOR_EXPECTED_ONLY: { readonly npm: readonly (readonly [string, string])[]; readonly binary: readonly (readonly [string, string])[] }
export function normalizeText(text: unknown, roots?: readonly string[]): string
export function sectionKey(line: string): string
export function compareLines(label: string, binaryLines: readonly string[], npmLines: readonly string[]): string[]
export const BINARY_ONLY_REQUIRED_STEPS: readonly string[]
export function binaryOnlyFailures(label: string, run: ParityRun): string[]
export function compareRuns(binary: ParityRun, npm: ParityRun): string[]
