export type TaskPhase = 'planning' | 'implementation' | 'review';

export interface PhaseRule {
  phase: TaskPhase;
  rules: string[];
}

export function getRulesForPhase(phase: TaskPhase): string[] {
  const rulesMap: Record<TaskPhase, string[]> = {
    planning: ['Always consider architecture before implementation'],
    implementation: ['Follow TDD and clean code principles'],
    review: ['Check for security vulnerabilities and performance bottlenecks'],
  };
  return rulesMap[phase] || [];
}

export function detectPhaseFromContext(context: string): TaskPhase {
  const lowerContext = context.toLowerCase();
  if (lowerContext.includes('review') || lowerContext.includes('check')) {
    return 'review';
  }
  if (lowerContext.includes('implement') || lowerContext.includes('coding') || lowerContext.includes('build')) {
    return 'implementation';
  }
  return 'planning';
}
