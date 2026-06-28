const BUILT_IN_REDACTION_REGEXES = [
  /((?:authorization|proxy-authorization):\s*(?:bearer|basic)\s+)[^\s"'<>]+/gi,
  /((?:"|')?(?:authorization|proxy-authorization)(?:"|')?\s*:\s*(?:"|')?(?:bearer|basic)\s+)[^"'\s,}\]\[]+((?:"|')?)/gi,
  /\b((?:api[_-]?key|token|password|secret|access[_-]?token|refresh[_-]?token)=["'])[^\r\n"']+(["'])/gi,
  /\b((?:api[_-]?key|token|password|secret|access[_-]?token|refresh[_-]?token)=)[^\s"'<>]+/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\b(?:github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(?:sk-[A-Za-z0-9_-]{20,})\b/g,
];

export const BUILT_IN_REDACTION_RULE_COUNT = BUILT_IN_REDACTION_REGEXES.length;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileRedactions({ redactions, redactRegexes }) {
  const rules = BUILT_IN_REDACTION_REGEXES.map((regex) => ({
    regex,
    preservePrefix: true,
  }));
  for (const literal of redactions) {
    if (literal.length > 0) {
      rules.push({ regex: new RegExp(escapeRegex(literal), "g"), preservePrefix: false });
    }
  }
  for (const source of redactRegexes) {
    rules.push({ regex: new RegExp(source, "g"), preservePrefix: false });
  }
  return rules;
}

export function redactEvidence(text, rules) {
  return rules.reduce(
    (current, rule) =>
      current.replace(rule.regex, (match, prefix, suffix) =>
        rule.preservePrefix && typeof prefix === "string"
          ? `${prefix}[REDACTED]${typeof suffix === "string" ? suffix : ""}`
          : "[REDACTED]",
      ),
    text,
  );
}
