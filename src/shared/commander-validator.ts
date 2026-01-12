/**
 * Commander Output Validator
 * Validates Commander output format, ensuring all required sections are present
 */

export interface CommanderOutput {
  verdict: "PASS" | "FAIL" | null;
  sections: string[];
  duplicates: string[];
  specComplete: boolean;
  acceptanceCriteriaComplete: boolean;
}

export interface CommanderValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate Commander output
 */
export function validateCommanderOutput(output: string): CommanderValidationResult {
  const result: CommanderValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  const sections: string[] = [];
  const duplicates: string[] = [];

  // Define required section markers
  const requiredSections = [
    "SPEC",
    "ACCEPTANCE CRITERIA",
    "FILES/FUNCTIONS TO CHANGE",
    "TASKS FOR IMPLEMENTER"
  ];

  // Check for VERDICT
  if (!output.includes("VERDICT:")) {
    result.errors.push("Missing VERDICT section");
  } else {
    const verdictMatch = output.match(/VERDICT:\s*(PASS|FAIL)/);
    if (!verdictMatch) {
      result.errors.push("Invalid VERDICT value (must be PASS or FAIL)");
    }
  }

  // Check for required sections
  for (const section of requiredSections) {
    const regex = new RegExp(`### ${section}`, "i");
    if (!regex.test(output)) {
      result.errors.push(`Missing required section: ${section}`);
    } else {
      sections.push(section);
    }
  }

  // Check for duplicate sections
  for (const section of requiredSections) {
    const regex = new RegExp(`### ${section}`, "gi");
    const matches = output.match(regex);
    if (matches && matches.length > 1) {
      duplicates.push(section);
      result.errors.push(`Duplicate section found: ${section}`);
    }
  }

  // Validate SPEC section (<= 15 items)
  const specSection = output.match(/### SPEC\s*\n([\s\S]*?)(?=###|$)/i);
  if (specSection) {
    const specItems = specSection[1].match(/^\d+\./gm);
    if (specItems && specItems.length > 15) {
      result.warnings.push(`SPEC has ${specItems.length} items (max 15)`);
    }
  }

  // Validate ACCEPTANCE CRITERIA section (<= 10 items)
  const acSection = output.match(/### ACCEPTANCE CRITERIA\s*\n([\s\S]*?)(?=###|$)/i);
  if (acSection) {
    const acItems = acSection[1].match(/^\d+\./gm);
    if (acItems && acItems.length > 10) {
      result.warnings.push(`ACCEPTANCE CRITERIA has ${acItems.length} items (max 10)`);
    }
  }

  result.isValid = result.errors.length === 0;
  return result;
}
