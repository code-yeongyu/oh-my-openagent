/**
 * Oracle Output Validator
 * Validates Oracle output format, ensuring VERDICT and CRITERIA CHECK table
 */

export interface ReviewerOutput {
  verdict: "PASS" | "FAIL" | null;
  criteriaCheck: Array<{ ac: string; status: "OK" | "FAIL"; notes: string }>;
  riskPoints: string[];
  missingTests: string[];
  architectureUnclear?: boolean;
}

export interface ReviewerValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate Oracle output
 */
export function validateOracleOutput(output: string): ReviewerValidationResult {
  const result: ReviewerValidationResult = {
    isValid: true,
    errors: [],
  };

  // 1. Must start with VERDICT
  if (!output.includes("VERDICT:")) {
    result.errors.push("Missing VERDICT section");
  }

  // 2. VERDICT must be PASS or FAIL
  const verdictMatch = output.match(/VERDICT:\s*(PASS|FAIL)/);
  if (!verdictMatch) {
    result.errors.push("Invalid VERDICT value (must be PASS or FAIL)");
  }

  // 3. Must have CRITERIA CHECK table
  if (!output.includes("CRITERIA CHECK")) {
    result.errors.push("Missing CRITERIA CHECK table");
  }

  // 4. Validate CRITERIA CHECK table format
  const hasTable = /\|\s*\d+\s*\|\s*(Yes|No)\s*\|/i.test(output);

  // 5. Check for at least one criteria row
  const criteriaEntries = output.match(/\|\s*\d+\s*\|[^\n]+/gm);
  if (!criteriaEntries) {
    result.errors.push("CRITERIA CHECK table must have at least one entry");
  }

  // 6. RISK POINTS section (optional)
  const hasRiskSection = output.includes("RISK POINTS");
  if (!hasRiskSection) {
    // result.errors.push("Missing RISK POINTS section (optional)");
  }

  // 7. MISSING TESTS section (optional)
  const hasTestsSection = output.includes("MISSING TESTS");

  result.isValid = result.errors.length === 0;
  return result;
}
