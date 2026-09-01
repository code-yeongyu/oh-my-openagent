export type RedactionRule = {
  readonly regex: RegExp
  readonly preservePrefix: boolean
}

export declare const BUILT_IN_REDACTION_RULE_COUNT: number

export declare function compileRedactions(input: {
  readonly redactions: readonly string[]
  readonly redactRegexes: readonly string[]
}): RedactionRule[]

export declare function redactEvidence(text: string, rules: readonly RedactionRule[]): string
