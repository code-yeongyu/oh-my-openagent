/**
 * Isolation Checker - Detects direct database/network operations in test files
 *
 * Tests should be isolated and not depend on external services.
 * This utility detects if tests make real network/database calls instead of using mocks.
 */

export interface IsolationResult {
  isolated: boolean;
  violations: string[];
}

interface PatternDefinition {
  pattern: RegExp;
  label: string;
}

const NETWORK_PATTERNS: PatternDefinition[] = [
  { pattern: /\bfetch\s*\(/, label: "fetch()" },
  { pattern: /\baxios\./, label: "axios" },
  { pattern: /\bhttp\.request\s*\(/, label: "http.request()" },
  { pattern: /\bhttps\.request\s*\(/, label: "https.request()" },
  { pattern: /\bnet\.connect\s*\(/, label: "net.connect()" },
];

const DATABASE_PATTERNS: PatternDefinition[] = [
  { pattern: /\bnew\s+Client\s*\(/, label: "new Client() (pg)" },
  { pattern: /\bpg\.connect\s*\(/, label: "pg.connect()" },
  { pattern: /\bmysql\.createConnection\s*\(/, label: "mysql.createConnection()" },
  { pattern: /\bmongoClient\.connect\s*\(/, label: "mongoClient.connect()" },
  { pattern: /\bnew\s+MongoClient\s*\(/, label: "new MongoClient()" },
  { pattern: /\bMongoClient\s*\(/, label: "MongoClient()" },
  { pattern: /\bredis\.createClient\s*\(/, label: "redis.createClient()" },
];

const ALL_PATTERNS: PatternDefinition[] = [...NETWORK_PATTERNS, ...DATABASE_PATTERNS];

/**
 * Checks test file content for isolation violations.
 *
 * Detects direct network calls (fetch, axios, http) and database connections
 * (pg, mysql, mongodb, redis) that indicate tests are not properly isolated.
 *
 * @param testFileContent - The content of the test file to analyze
 * @returns IsolationResult with isolated status and list of violations
 */
export function checkIsolation(testFileContent: string): IsolationResult {
  if (!testFileContent || testFileContent.trim().length === 0) {
    return { isolated: true, violations: [] };
  }

  const violations: string[] = [];

  for (const { pattern, label } of ALL_PATTERNS) {
    if (pattern.test(testFileContent)) {
      violations.push(label);
    }
  }

  return {
    isolated: violations.length === 0,
    violations,
  };
}
