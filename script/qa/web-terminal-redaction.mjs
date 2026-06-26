const BUILT_IN_REDACTION_RULES = [
  /((?:authorization|proxy-authorization):\s*(?:bearer|basic)\s+)[^\s"'<>]+/gi,
  /\b((?:api[_-]?key|token|password|secret|access[_-]?token|refresh[_-]?token)=)[^\s"'<>]+/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\b(?:github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(?:sk-[A-Za-z0-9_-]{20,})\b/g,
];

export const BUILT_IN_REDACTION_RULE_COUNT = BUILT_IN_REDACTION_RULES.length;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileRedactions({ redactions, redactRegexes }) {
  const rules = [...BUILT_IN_REDACTION_RULES];
  for (const literal of redactions) {
    if (literal.length > 0) rules.push(new RegExp(escapeRegex(literal), "g"));
  }
  for (const source of redactRegexes) {
    rules.push(new RegExp(source, "g"));
  }
  return rules;
}

export function redactEvidence(text, rules) {
  return rules.reduce(
    (current, rule) =>
      current.replace(rule, (match, prefix) =>
        typeof prefix === "string" ? `${prefix}[REDACTED]` : "[REDACTED]",
      ),
    text,
  );
}
