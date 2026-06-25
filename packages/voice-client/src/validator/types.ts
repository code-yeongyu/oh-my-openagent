export type Violation = {
  ruleId: string;
  offset: number;
  length: number;
  snippet: string;
  description: string;
};

export type ValidationResult = { ok: true } | { ok: false; violations: Violation[] };

export type GrammarRule = {
  id: string;
  regex: RegExp;
  description: string;
  kind: "forbidden" | "allowed-exception";
};
