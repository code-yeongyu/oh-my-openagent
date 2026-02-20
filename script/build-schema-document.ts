import * as z from "zod"
import { OhMyOpenCodeConfigSchema } from "../src/config/schema"

/**
 * Extracts repeated schema definitions into $defs and replaces them with $ref.
 * This reduces schema duplication when the same schema is used multiple times.
 */
function deduplicateSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(schema)) // Deep clone
  const definitions: Record<string, unknown> = {}

  // Check if this is the agents property with repeated agent configs
  if (result.properties?.agents?.properties) {
    const agentProperties = result.properties.agents.properties as Record<string, unknown>
    const agentNames = Object.keys(agentProperties)

    if (agentNames.length >= 2) {
      // Compare all agent configs to find the common schema
      const firstAgentConfig = JSON.stringify(agentProperties[agentNames[0]])
      const allIdentical = agentNames.every(
        (name) => JSON.stringify(agentProperties[name]) === firstAgentConfig
      )

      if (allIdentical && firstAgentConfig.length > 100) {
        // Extract the common agent config to definitions
        const commonConfig = agentProperties[agentNames[0]]
        definitions["AgentOverrideConfig"] = commonConfig

        // Replace each agent with a $ref
        for (const name of agentNames) {
          agentProperties[name] = {
            $ref: "#/definitions/AgentOverrideConfig",
          }
        }

        result.definitions = { ...result.definitions, ...definitions }
      }
    }
  }

  return result
}

export function createOhMyOpenCodeJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(OhMyOpenCodeConfigSchema, {
    target: "draft-07",
    unrepresentable: "any",
  })

  // Deduplicate repeated schemas before returning
  const deduplicated = deduplicateSchema(jsonSchema as Record<string, unknown>)

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
    title: "Oh My OpenCode Configuration",
    description: "Configuration schema for oh-my-opencode plugin",
    ...deduplicated,
  }
}
