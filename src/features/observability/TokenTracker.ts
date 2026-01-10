export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model?: string;
}

export class TokenTracker {
  private usage: Map<string, TokenUsage[]> = new Map();

  // Costs per 1M tokens
  private static COSTS_PER_MILLION_TOKENS = {
    "claude-3-opus-20240229": { input: 15.00, output: 75.00 },
    "claude-3-sonnet-20240229": { input: 3.00, output: 15.00 },
    "claude-3-5-sonnet": { input: 3.00, output: 15.00 },
    "claude-3-5-sonnet-20240620": { input: 3.00, output: 15.00 },
    "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  };

  track(agentId: string, type: "input" | "output", count: number, model: string = "claude-3-5-sonnet") {
    if (!this.usage.has(agentId)) {
      this.usage.set(agentId, []);
    }
    
    const records = this.usage.get(agentId)!;
    let record = records.find(r => r.model === model);
    if (!record) {
      record = { inputTokens: 0, outputTokens: 0, model };
      records.push(record);
    }

    if (type === "input") {
      record.inputTokens += count;
    } else {
      record.outputTokens += count;
    }
  }

  getUsage(agentId: string): { inputTokens: number; outputTokens: number } {
    const records = this.usage.get(agentId) || [];
    return records.reduce((acc, curr) => ({
      inputTokens: acc.inputTokens + curr.inputTokens,
      outputTokens: acc.outputTokens + curr.outputTokens
    }), { inputTokens: 0, outputTokens: 0 });
  }

  estimateCost(agentId: string): number {
    const records = this.usage.get(agentId) || [];
    return records.reduce((total, record) => {
      const modelCost = this.getModelCost(record.model);
      const inputCost = (record.inputTokens / 1_000_000) * modelCost.input;
      const outputCost = (record.outputTokens / 1_000_000) * modelCost.output;
      return total + inputCost + outputCost;
    }, 0);
  }

  private getModelCost(model: string = "claude-3-5-sonnet") {
    const cost = TokenTracker.COSTS_PER_MILLION_TOKENS[model as keyof typeof TokenTracker.COSTS_PER_MILLION_TOKENS];
    if (cost) return cost;

    return TokenTracker.COSTS_PER_MILLION_TOKENS["claude-3-5-sonnet"];
  }

  getAllUsage() {
    return Array.from(this.usage.entries()).map(([agentId, records]) => ({
        agentId,
        records
    }));
  }
}
