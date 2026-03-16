export interface CostReport {
  total: number;
  perAgent: Record<string, number>;
}

export class CostTracker {
  private usage: Map<string, number> = new Map();

  addUsage(agentId: string, tokens: number): void {
    const current = this.usage.get(agentId) ?? 0;
    this.usage.set(agentId, current + tokens);
  }

  getTotalUsage(): number {
    let total = 0;
    for (const tokens of this.usage.values()) {
      total += tokens;
    }
    return total;
  }

  isOverBudget(budget: number): boolean {
    return this.getTotalUsage() > budget;
  }

  getReport(): CostReport {
    const perAgent: Record<string, number> = {};
    for (const [agentId, tokens] of this.usage.entries()) {
      perAgent[agentId] = tokens;
    }
    return {
      total: this.getTotalUsage(),
      perAgent,
    };
  }
}
