import type { ComplexityScore } from "../types";

const CONCERN_DOMAINS: Record<string, RegExp> = {
  auth: /\b(auth(?:entication|orization)?|login|logout|signup|sign[- ]?up|sign[- ]?in|oauth|jwt|sessions?|tokens?|passwords?|credentials?|permissions?|rbac|acl)\b/i,
  frontend: /\b(frontend|front[- ]?end|react|vue|angular|svelte|ui|ux|components?|css|html|layout|responsive|tailwind|styled|dom|browser)\b/i,
  backend: /\b(backend|back[- ]?end|apis?|servers?|express|fastify|nest|endpoints?|middleware|rest|graphql|routes?|controllers?|services?)\b/i,
  database: /\b(database|db|postgres|postgresql|mysql|mongo|mongodb|redis|sql|schemas?|migrations?|orm|prisma|drizzle|quer(?:y|ies)|tables?|index(?:es)?)\b/i,
  infra: /\b(infra|infrastructure|docker|kubernetes|k8s|ci\/cd|ci|cd|pipelines?|deploy(?:ment)?|terraform|aws|gcp|azure|nginx|load[- ]?balancers?|monitoring|logging)\b/i,
  testing: /\b(tests?|testing|e2e|integration[- ]?tests?|unit[- ]?tests?|cypress|playwright|jest|coverage)\b/i,
  payments: /\b(payments?|stripe|billing|checkout|subscriptions?|invoic(?:e|ing)|pricing|e-commerce|ecommerce|commerce)\b/i,
};

const CROSS_DOMAIN_SIGNALS: RegExp[] = [
  /\bfull[- ]?stack\b/i,
  /\bend[- ]?to[- ]?end\b/i,
  /\bmicro[- ]?service/i,
  /\bmonorepo\b/i,
  /\bplatform\b/i,
];

const SCALE_SIGNALS: RegExp[] = [
  /\bfull\b/i,
  /\bentire\b/i,
  /\bcomplete\b/i,
  /\bwhole\b/i,
  /\bcomprehensive\b/i,
  /\bbuild\b/i,
  /\bplatform\b/i,
  /\bsystem\b/i,
  /\bapplication\b/i,
];

const CONCERN_WEIGHT = 12;
const CROSS_DOMAIN_BONUS = 17;
const SCALE_BONUS = 5;
const CONTEXT_BONUS = 5;
const FILES_PER_CONCERN = 3;
const BASE_FILES = 1;

function detectConcerns(text: string): string[] {
  const detected: string[] = [];
  for (const [domain, pattern] of Object.entries(CONCERN_DOMAINS)) {
    if (pattern.test(text)) {
      detected.push(domain);
    }
  }
  return detected;
}

function detectCrossDomain(text: string, concernCount: number): boolean {
  for (const signal of CROSS_DOMAIN_SIGNALS) {
    if (signal.test(text)) return true;
  }
  return concernCount >= 3;
}

function detectScaleSignals(text: string): number {
  let count = 0;
  for (const signal of SCALE_SIGNALS) {
    if (signal.test(text)) count++;
  }
  return Math.min(count, 3);
}

function scoreProjectContext(context: string): number {
  if (!context) return 0;
  const lower = context.toLowerCase();
  let bonus = 0;
  if (/monorepo|multiple.*package|workspace/i.test(lower)) bonus += CONTEXT_BONUS;
  if (/frontend.*backend|backend.*frontend|micro/i.test(lower)) bonus += CONTEXT_BONUS;
  return Math.min(bonus, CONTEXT_BONUS * 2);
}

export function scoreComplexity(
  request: string,
  projectContext?: string
): ComplexityScore {
  if (!request || request.trim().length === 0) {
    return {
      total: 0,
      concern_count: 0,
      file_count_estimate: 1,
      cross_domain: false,
      reasoning: "Empty request",
    };
  }

  const concerns = detectConcerns(request);
  const concernCount = concerns.length;
  const crossDomain = detectCrossDomain(request, concernCount);
  const scaleCount = detectScaleSignals(request);

  let score = concernCount * CONCERN_WEIGHT;
  if (crossDomain) score += CROSS_DOMAIN_BONUS;
  score += scaleCount * SCALE_BONUS;

  if (projectContext) {
    score += scoreProjectContext(projectContext);
  }

  const total = Math.max(0, Math.min(100, score));
  const fileEstimate = Math.max(BASE_FILES, concernCount * FILES_PER_CONCERN);

  const parts: string[] = [];
  if (concernCount > 0) parts.push(`${concernCount} domain(s): ${concerns.join(", ")}`);
  else parts.push("No specific domains detected");
  if (crossDomain) parts.push("cross-domain signals detected");
  if (scaleCount > 0) parts.push(`${scaleCount} scale signal(s)`);
  if (projectContext) parts.push("project context factored in");

  return {
    total,
    concern_count: concernCount,
    file_count_estimate: fileEstimate,
    cross_domain: crossDomain,
    reasoning: parts.join("; "),
  };
}
