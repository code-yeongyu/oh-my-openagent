import picomatch from 'picomatch';

export interface QualityGateConfig {
  whitelist?: string[];
}

export interface QualityGateResult {
  passed: boolean;
  warnings: string[];
}

/**
 * Checks test code for anti-patterns like direct database operations or network requests.
 * Warnings are generated but the check does not block (passed is always true unless explicitly changed).
 */
export function checkTestQuality(
  content: string,
  filePath: string,
  config: QualityGateConfig = {}
): QualityGateResult {
  const result: QualityGateResult = {
    passed: true,
    warnings: [],
  };

  //#given: check if the file is in the whitelist
  if (config.whitelist) {
    const isWhitelisted = config.whitelist.some((pattern) =>
      picomatch.isMatch(filePath, pattern)
    );
    if (isWhitelisted) {
      return result;
    }
  }

  //#when: detecting database operations
  const dbPatterns = [
    /\bdb\./,
    /\bmongoose\./,
    /\bprisma\./,
    /\bKnex\b/,
    /\bSequelize\b/,
    /\binsertOne\b/,
    /\binsertMany\b/,
    /\bupdateOne\b/,
    /\bupdateMany\b/,
    /\bdeleteOne\b/,
    /\bdeleteMany\b/,
    /\bfind\(/,
    /\bfindOne\(/,
  ];

  if (dbPatterns.some((pattern) => pattern.test(content))) {
    result.warnings.push('Direct database operation detected');
  }

  //#when: detecting network requests
  const networkPatterns = [
    /\bfetch\(/,
    /\baxios\./,
    /\bhttp\.request\(/,
    /\bhttps\.request\(/,
    /\bXMLHttpRequest\b/,
  ];

  if (networkPatterns.some((pattern) => pattern.test(content))) {
    result.warnings.push('Direct network request detected');
  }

  return result;
}
