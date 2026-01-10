import { TokenTracker } from "./TokenTracker";
import { DecisionJournal } from "./DecisionJournal";

export class WorkSummary {
  constructor(private tracker: TokenTracker, private journal: DecisionJournal) {}

  generate(): string {
    const usages = this.tracker.getAllUsage();
    
    let report = "# Work Summary\n\n";
    
    report += "## Token Usage\n";
    if (usages.length === 0) {
      report += "No token usage recorded.\n";
    } else {
      for (const { agentId } of usages) {
        const usage = this.tracker.getUsage(agentId);
        const cost = this.tracker.estimateCost(agentId);
        report += `- **${agentId}**: ${usage.inputTokens} input, ${usage.outputTokens} output ($${cost.toFixed(4)})\n`;
      }
    }

    return report;
  }
}
