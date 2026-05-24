import { Command } from "commander"
import {
  retrieveMemories,
  getRecentMemories,
  storeMemory,
  deleteMemory,
  clearAllMemories,
  getMemoryStats,
} from "../../features/semantic-memory"
import type { MemoryEntry } from "../../features/semantic-memory"

interface MemoryOptions {
  agent?: string
  type?: string
  limit?: string
  format?: string
  minImportance?: string
  hours?: string
}

function formatMemoryEntry(entry: MemoryEntry, index: number): string {
  const lines = [
    `[${index + 1}] ${entry.memoryType.toUpperCase()} (importance: ${entry.importance})`,
    `    Content: ${entry.content.substring(0, 100)}${entry.content.length > 100 ? "..." : ""}`,
    `    Agent: ${entry.agentName ?? "unknown"} | Session: ${entry.sessionId ?? "unknown"}`,
    `    Created: ${entry.createdAt.toISOString()} | Accessed: ${entry.accessCount} times`,
    "",
  ]
  return lines.join("\n")
}

function formatAsJson(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

export function createMemoryCommand(): Command {
  const command = new Command("memory")
    .description("Semantic memory and cross-session context retrieval")

  command
    .command("search <query>")
    .description("Search memories by semantic similarity")
    .option("-a, --agent <agent>", "Filter by agent name")
    .option("-t, --type <type>", "Filter by memory type (context, decision, error, pattern, insight)")
    .option("-l, --limit <n>", "Maximum number of results", "5")
    .option("-f, --format <format>", "Output format (text, json)", "text")
    .option("-m, --min-importance <score>", "Minimum importance threshold", "0")
    .action((query: string, options: MemoryOptions) => {
      try {
        const results = retrieveMemories({
          query,
          agentName: options.agent,
          memoryType: options.type as MemoryEntry["memoryType"],
          limit: parseInt(options.limit ?? "5", 10),
          minImportance: parseFloat(options.minImportance ?? "0"),
        })

        if (options.format === "json") {
          console.log(formatAsJson(results))
          return
        }

        if (results.length === 0) {
          console.log("No memories found matching your query.")
          return
        }

        console.log(`Found ${results.length} memories:\n`)
        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          console.log(`[${i + 1}] ${result.entry.memoryType.toUpperCase()} (similarity: ${(result.similarity * 100).toFixed(1)}%, importance: ${result.entry.importance})`)
          console.log(`    Content: ${result.entry.content}`)
          console.log(`    Agent: ${result.entry.agentName ?? "unknown"} | Session: ${result.entry.sessionId ?? "unknown"}`)
          console.log(`    Created: ${result.entry.createdAt.toISOString()}`)
          console.log("")
        }
      } catch (error) {
        console.error("Error searching memories:", error)
        process.exit(1)
      }
    })

  command
    .command("recent")
    .description("Show recent memories")
    .option("-a, --agent <agent>", "Filter by agent name")
    .option("-t, --type <type>", "Filter by memory type")
    .option("-l, --limit <n>", "Maximum number of results", "10")
    .option("-f, --format <format>", "Output format (text, json)", "text")
    .option("-h, --hours <n>", "Only show memories from last N hours")
    .action((options: MemoryOptions) => {
      try {
        const memories = getRecentMemories({
          agentName: options.agent,
          memoryType: options.type as MemoryEntry["memoryType"],
          limit: parseInt(options.limit ?? "10", 10),
          hours: options.hours ? parseInt(options.hours, 10) : undefined,
        })

        if (options.format === "json") {
          console.log(formatAsJson(memories))
          return
        }

        if (memories.length === 0) {
          console.log("No recent memories found.")
          return
        }

        console.log(`Recent memories (${memories.length}):\n`)
        for (let i = 0; i < memories.length; i++) {
          console.log(formatMemoryEntry(memories[i], i))
        }
      } catch (error) {
        console.error("Error retrieving memories:", error)
        process.exit(1)
      }
    })

  command
    .command("store <content>")
    .description("Store a new memory")
    .option("-a, --agent <agent>", "Agent name")
    .option("-t, --type <type>", "Memory type", "context")
    .option("-i, --importance <score>", "Importance score (0-5)", "1.0")
    .option("-s, --session <session>", "Session ID")
    .action((content: string, options: MemoryOptions & { importance?: string; session?: string }) => {
      try {
        const entry = storeMemory(content, {
          agentName: options.agent,
          sessionId: options.session,
          memoryType: options.type as MemoryEntry["memoryType"],
          importance: parseFloat(options.importance ?? "1.0"),
        })
        console.log(`Memory stored with ID: ${entry.id}`)
      } catch (error) {
        console.error("Error storing memory:", error)
        process.exit(1)
      }
    })

  command
    .command("delete <id>")
    .description("Delete a memory by ID")
    .action((id: string) => {
      try {
        const deleted = deleteMemory(id)
        if (deleted) {
          console.log(`Memory ${id} deleted successfully.`)
        } else {
          console.log(`Memory ${id} not found.`)
        }
      } catch (error) {
        console.error("Error deleting memory:", error)
        process.exit(1)
      }
    })

  command
    .command("stats")
    .description("Show memory statistics")
    .option("-f, --format <format>", "Output format (text, json)", "text")
    .action((options: MemoryOptions) => {
      try {
        const stats = getMemoryStats()

        if (options.format === "json") {
          console.log(formatAsJson(stats))
          return
        }

        console.log("Memory Statistics")
        console.log("=================")
        console.log(`Total Memories: ${stats.totalMemories}`)
        console.log(`Average Importance: ${stats.avgImportance.toFixed(2)}`)
        console.log("\nBy Type:")
        for (const [type, count] of Object.entries(stats.byType)) {
          console.log(`  ${type}: ${count}`)
        }
        console.log("\nBy Agent:")
        for (const [agent, count] of Object.entries(stats.byAgent)) {
          console.log(`  ${agent}: ${count}`)
        }
      } catch (error) {
        console.error("Error getting memory stats:", error)
        process.exit(1)
      }
    })

  command
    .command("clear")
    .description("Clear all memories (use with caution)")
    .action(() => {
      clearAllMemories()
      console.log("All memories cleared.")
    })

  return command
}
