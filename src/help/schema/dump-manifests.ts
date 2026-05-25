import { z } from "zod"

/**
 * Help JSON schema for the `dump-manifests` surface.
 * Defines the structure of configuration manifest dump output.
 */
export const ManifestEntrySchema = z
  .object({
    key: z.string().describe("Manifest entry key"),
    value: z.unknown().describe("Manifest entry value"),
    source: z.string().optional().describe("Source file or origin"),
    type: z.string().optional().describe("Value type description"),
  })
  .meta({ ref: "ManifestEntry" })

export const ConfigManifestSchema = z
  .object({
    name: z.string().describe("Configuration name"),
    entries: z.array(ManifestEntrySchema).describe("Configuration entries"),
    filePath: z.string().describe("Path to the config file"),
    format: z.string().describe("Config file format (json, yaml, etc.)"),
    valid: z.boolean().describe("Whether the config parses correctly"),
  })
  .meta({ ref: "ConfigManifest" })

export const PluginManifestSchema = z
  .object({
    name: z.string().describe("Plugin name"),
    version: z.string().nullable().describe("Plugin version"),
    path: z.string().describe("Plugin install path"),
    enabled: z.boolean().describe("Whether the plugin is enabled"),
    commands: z.array(z.string()).optional().describe("Commands the plugin provides"),
    schemas: z.array(z.string()).optional().describe("JSON schemas the plugin registers"),
  })
  .meta({ ref: "PluginManifest" })

export const DumpManifestsResultSchema = z
  .object({
    configs: z.array(ConfigManifestSchema).describe("Configuration manifests"),
    plugins: z.array(PluginManifestSchema).describe("Plugin manifests"),
    timestamp: z.number().describe("Dump timestamp (epoch ms)"),
  })
  .meta({ ref: "DumpManifestsResult" })

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>
export type ConfigManifest = z.infer<typeof ConfigManifestSchema>
export type PluginManifest = z.infer<typeof PluginManifestSchema>
export type DumpManifestsResult = z.infer<typeof DumpManifestsResultSchema>
