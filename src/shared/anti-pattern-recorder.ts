/**
 * Recorder for failed solution attempts to avoid repeating mistakes.
 */
export interface FailureRecord {
  attempt: string;
  reason: string;
}

export class AntiPatternRecorder {
  private failures: FailureRecord[] = [];
  private readonly MAX_FAILURES = 10;

  /**
   * Records a failed solution attempt with its reason.
   */
  recordFailure(attempt: string, reason: string): void {
    this.failures.push({ attempt, reason });
    if (this.failures.length > this.MAX_FAILURES) {
      this.failures = this.failures.slice(-this.MAX_FAILURES);
    }
  }

  /**
   * Returns the list of recorded failures.
   */
  getFailures(): FailureRecord[] {
    return [...this.failures];
  }

  /**
   * Summarizes failure patterns for compression.
   */
  summarizeForCompression(): string {
    if (this.failures.length === 0) return "";

    return "Failed approaches:\n" + 
      this.failures.map(f => `- ${f.attempt}: ${f.reason}`).join("\n");
  }

  /**
   * Injects failure patterns into a prompt to warn the agent.
   */
  injectIntoPrompt(prompt: string): string {
    if (this.failures.length === 0) return prompt;

    const warning = "\nAvoid these failed approaches:\n" + 
      this.failures.map(f => `- ${f.attempt}: ${f.reason}`).join("\n");
    
    return `${prompt}\n${warning}`;
  }
}
