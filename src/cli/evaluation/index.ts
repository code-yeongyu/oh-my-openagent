import { Command } from "commander"
import {
  getAgentScore,
  getEvaluationMetrics,
  getRecentEvaluations,
  clearEvaluations,
} from "../../features/auto-evaluation"

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
        const stats = getEvaluationMetrics()

        if (options.format === "json") {
          console.log(JSON.stringify(stats, null, 2))
          return
        }

        console.log("Evaluation Statistics")
        console.log("=====================")
        console.log(`Total Evaluations: ${stats.totalEvaluations}`)
        console.log(`Average Completion Score: ${stats.avgCompletionScore}/100`)
        console.log(`Average Quality Score: ${stats.avgQualityScore}/100`)
        console.log(`Average Efficiency Score: ${stats.avgEfficiencyScore}/100`)
        console.log(`Error Rate: ${stats.errorRate}`)
        console.log(`Todo Completion Rate: ${(stats.todoCompletionRate * 100).toFixed(1)}%`)
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

        if (!score) {
          console.log(`No evaluations found for agent: ${name}`)
          return
        }

        if (options.format === "json") {
          console.log(JSON.stringify(score, null, 2))
          return
        }

        console.log(`Agent Evaluation: ${name}`)
        console.log("========================")
        console.log(`Overall Score: ${score.overallScore}/100`)
        console.log(`Trend: ${score.trend}`)
        console.log(`Total Evaluations: ${score.metrics.totalEvaluations}`)
        console.log(`Completion Score: ${score.metrics.avgCompletionScore}/100`)
        console.log(`Quality Score: ${score.metrics.avgQualityScore}/100`)
        console.log(`Efficiency Score: ${score.metrics.avgEfficiencyScore}/100`)
        console.log(`Error Rate: ${score.metrics.errorRate}`)
        console.log(`\nRecommendation: ${score.recommendation}`)
      } catch (error) {
        console.error("Error getting agent score:", error)
        process.exit(1)
      }
    })

  command
    .command("recent")
    .description("Show recent evaluations")
    .option("-a, --agent <agent>", "Filter by agent name")
    .option("-c, --category <category>", "Filter by category")
    .option("-d, --days <days>", "Number of days to look back", "7")
    .option("-l, --limit <n>", "Maximum number of results", "10")
    .option("-f, --format <format>", "Output format (text, json)", "text")
    .action((options: EvaluationOptions & { agent?: string; category?: string; days?: string; limit?: string }) => {
      try {
        const evaluations = getRecentEvaluations({
          agentName: options.agent,
          category: options.category,
          days: parseInt(options.days ?? "7", 10),
          limit: parseInt(options.limit ?? "10", 10),
        })

        if (options.format === "json") {
          console.log(JSON.stringify(evaluations, null, 2))
          return
        }

        console.log("Recent Evaluations")
        console.log("==================")
        for (const eval_ of evaluations) {
          console.log(`\n[${eval_.agentName}] ${eval_.evaluatedAt.toISOString()}`)
          console.log(`  Task: ${eval_.taskDescription ?? "N/A"}`)
          console.log(`  Completion: ${eval_.completionScore}/100 | Quality: ${eval_.qualityScore}/100 | Efficiency: ${eval_.efficiencyScore}/100`)
          console.log(`  Errors: ${eval_.errorCount} | Tool Calls: ${eval_.toolCallCount} | Duration: ${eval_.durationMs}ms`)
          console.log(`  Todos: ${eval_.todosCompleted}/${eval_.todosTotal}`)
          if (eval_.feedback) {
            console.log(`  Feedback: ${eval_.feedback}`)
          }
        }
      } catch (error) {
        console.error("Error getting recent evaluations:", error)
        process.exit(1)
      }
    })

  command
    .command("clear")
    .description("Clear all evaluation data")
    .option("-a, --agent <agent>", "Clear only for specific agent")
    .action((options: { agent?: string }) => {
      try {
        if (options.agent) {
          clearEvaluations({ agentName: options.agent })
          console.log(`Cleared evaluations for agent: ${options.agent}`)
        } else {
          clearEvaluations("all")
          console.log("Cleared all evaluation data")
        }
      } catch (error) {
        console.error("Error clearing evaluations:", error)
        process.exit(1)
      }
    })

  return command
}
