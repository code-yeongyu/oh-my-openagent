export interface CriticIssue {
  message: string;
  type: "error" | "warning";
  line?: number;
}

export interface CriticResult {
  passed: boolean;
  issues: CriticIssue[];
}

export type Strictness = "low" | "medium" | "high";

export interface CriticConfig {
  strictness: Strictness;
}

/**
 * CriticVerifier - Performs semantic code review and validation.
 * Supports different strictness levels and returns specific issue lists on failure.
 */
export class CriticVerifier {
  constructor(private config: CriticConfig = { strictness: "medium" }) {}

  /**
   * Verifies code using semantic analysis.
   * In production, this would interface with a critic LLM model.
   */
  async verify(code: string): Promise<CriticResult> {
    const issues: CriticIssue[] = [];

    //#when: performing semantic checks
    
    // Check for common async race conditions (Semantic Check)
    if (code.includes("fetch") && (code.includes(".then") || code.includes("await")) && code.includes("return data")) {
      // Simplified heuristic for: fetch(...).then(d => data = d); return data;
      if (code.indexOf("return data") > code.indexOf("fetch") && !code.includes("await fetch")) {
        issues.push({
          message: "Semantic issue: Potential race condition. Returning data before async operation completes.",
          type: "error"
        });
      }
    }

    // Check for dangerous patterns
    if (code.includes("eval(")) {
      issues.push({
        message: "Security issue: Use of eval() is dangerous and can lead to code injection.",
        type: "error",
      });
    }

    //#when: applying strictness rules
    if (this.config.strictness === "high") {
      // High strictness: minor style issues are errors/warnings
      if (code.includes("const x = 1") && !code.includes(";")) {
        issues.push({
          message: "Style issue: Missing semicolon in high strictness mode.",
          type: "warning"
        });
      }
    }

    if (this.config.strictness === "medium" || this.config.strictness === "high") {
      // Medium/High: var is discouraged
      if (code.includes("var ")) {
        issues.push({
          message: "Style issue: Use 'const' or 'let' instead of 'var'.",
          type: "warning"
        });
      }
    }

    return {
      passed: !issues.some(issue => issue.type === "error"),
      issues,
    };
  }
}
