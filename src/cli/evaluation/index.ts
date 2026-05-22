import { Command } from "commander"
import {
  getAgentScore,
  getBestAgentForCategory,
  getEvaluationStats,
  clearAllEvaluations,
} from "@oh-my-opencode/auto-evaluation"

interface EvaluationOptions {
  format?: string
}

export function createEvaluationCommand(): Command {
  const command = new Command("evaluation")
    .description("Auto-evaluation and quality scoring for agent sessions")

  command
    .command("stats")
    .description("Show evaluation statistics")
    .option("-f, --format <format>", "Output format (text, json)", "text")
    .action((options: EvaluationOptions) => {
      try {
        const stats = getEvaluationStats()

        if (options.format === "json") {
          console.log(JSON.stringify(stats, null, 2))
          return
        }

        console.log("Evaluation Statistics")
        console.log("=====================")
        console.log(`Total Evaluations: ${stats.totalEvaluations}`)
        console.log(`Average Overall Score: ${stats.averageOverallScore}/100`)

        console.log("\nBy Agent:")
        for (const [agent, data] of Object.entries(stats.byAgent)) {
          console.log(`  ${agent}: ${data.count} evaluations, avg ${data.avgScore}/100`)
        }

        console.log("\nBy Category:")
        for (const [category, data] of Object.entries(stats.byCategory)) {
          console.log(`  ${category}: ${data.count} evaluations, avg ${data.avgScore}/100`)
        }
      } catch (error) {
        console.error("Error getting evaluation stats:", error)
        process.exit(1)
      }
    })

  command
    .command("agent <name>")
    .description("Show evaluation score for a specific agent")
    .option("-f, --format <format>", "Output format (text, json)", "text")
    .action((name: string, options: EvaluationOptions) => {
      try {
        const score = getAgentScore(name)

        if (options.format === "json") {
          console.log(JSON.stringify(score, null, 2))
          return
        }

        console.log(`Agent: ${name}`)
        console.log(`Average Score: ${score.averageScore}/100`)
        console.log(`Total Evaluations: ${score.totalEvaluations}`)
        console.log(`Recent Trend: ${score.recentTrend}`)
      } catch (error) {
        console.error("Error getting agent score:", error)
        process.exit(1)
      }
    })

  command
    .command("best <category>")
    .description("Show the best agent for a specific category")
    .option("-f, --format <format>", "Output format (text, json)", "text")
    .action((category: string, options: EvaluationOptions) => {
      try {
        const best = getBestAgentForCategory(category)

        if (!best) {
          console.log(`No evaluations found for category: ${category}`)
          return
        }

        if (options.format === "json") {
          console.log(JSON.stringify(best, null, 2))
          return
        }

        console.log(`Best Agent for ${category}:`)
        console.log(`  Agent: ${best.agentName}`)
        console.log(`  Average Score: ${best.averageScore}/100`)
      } catch (error) {
        console.error("Error getting best agent:", error)
        process.exit(1)
      }
    })

  command
    .command("clear")
    .description("Clear all evaluations (use with caution)")
    .action(() => {
      clearAllEvaluations()
      console.log("All evaluations cleared.")
    })

  return command
}
