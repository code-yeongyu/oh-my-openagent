import { describe, expect, it } from 'bun:test';
import { detectPhaseFromContext, getRulesForPhase } from './phase-aware-rules';

describe('PhaseAwareRules', () => {
  //#given
  const planningRules = ['design', 'architecture', 'planning'];
  const codingRules = ['clean code', 'typescript', 'coding'];
  const reviewRules = ['security', 'performance', 'review'];

  it('should inject design rules in planning phase', () => {
    //#when
    const rules = getRulesForPhase('planning');
    //#then
    expect(rules).toContain('Always consider architecture before implementation');
  });

  it('should inject coding rules in implementation phase', () => {
    //#when
    const rules = getRulesForPhase('implementation');
    //#then
    expect(rules).toContain('Follow TDD and clean code principles');
  });

  it('should inject review rules in review phase', () => {
    //#when
    const rules = getRulesForPhase('review');
    //#then
    expect(rules).toContain('Check for security vulnerabilities and performance bottlenecks');
  });

  it('should detect current phase from context', () => {
    //#given
    const planningContext = 'I am planning a new feature for the plugin';
    const implementationContext = 'Implementing the UI for the dashboard';
    const reviewContext = 'Reviewing the PR for security updates';

    //#then
    expect(detectPhaseFromContext(planningContext)).toBe('planning');
    expect(detectPhaseFromContext(implementationContext)).toBe('implementation');
    expect(detectPhaseFromContext(reviewContext)).toBe('review');
  });
});
