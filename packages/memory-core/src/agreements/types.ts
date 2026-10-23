export const AGREEMENTS_PATH = "system/agreements.md"
export const AGREEMENTS_DESCRIPTION =
  "Agreements - standing working agreements with my person, with how often each was broken"
export const AGREEMENT_TEXT_MAX_CHARS = 240

export type AgreementScope = "global" | "project"
export type AgreementAuthor = "human" | "agent"
export type AgreementStatus = "active" | "needs-human"

export interface AgreementItem {
  readonly id: string
  readonly scope: AgreementScope
  readonly by: AgreementAuthor
  readonly text: string
  readonly n: number
  readonly since?: string
  readonly last?: string
  readonly status: AgreementStatus
}

export interface AgreementsPolicy {
  readonly needsHumanThreshold: number
  readonly maxItems: number
}

export const DEFAULT_AGREEMENTS_POLICY: AgreementsPolicy = { needsHumanThreshold: 3, maxItems: 64 }

export interface FactsKnownAgreement {
  readonly id: string
  readonly scope: AgreementScope
  readonly by: AgreementAuthor
  readonly text: string
  readonly n: number
}

export type AgreementExtractionRecord =
  | { readonly action: "new"; readonly applies: AgreementScope; readonly text: string; readonly date: string }
  | { readonly action: "reaffirm"; readonly id: string; readonly date: string; readonly text?: string }
