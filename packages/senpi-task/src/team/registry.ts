import type { Dirent } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

import type { TeamSpec } from "@oh-my-opencode/team-core/types"

import { SenpiTeamSpecError } from "./errors"
import { type SenpiTeamMemberPorts, validateSenpiTeamMembers } from "./member-validator"
import { normalizeSenpiTeamSpec } from "./normalize"
import { resolveProjectTeamSpecPath } from "./storage"

export type TeamSpecSource = "project" | "omo-json"

export type TeamRegistryEntry = {
  readonly name: string
  readonly source: TeamSpecSource
  readonly spec: TeamSpec
}

export type TeamRegistryError = {
  readonly name: string
  readonly source: TeamSpecSource
  readonly code: string
  readonly message: string
}

export type LoadTeamRegistryInput = {
  readonly projectRoot: string
  readonly omoTeams?: Record<string, unknown>
  readonly ports: SenpiTeamMemberPorts
}

export type LoadTeamRegistryResult = {
  readonly teams: readonly TeamRegistryEntry[]
  readonly errors: readonly TeamRegistryError[]
}

type RawProjectSpec = {
  readonly name: string
  readonly rawText: string
}

function toRegistryError(name: string, source: TeamSpecSource, error: unknown): TeamRegistryError {
  if (error instanceof SenpiTeamSpecError) {
    return { name, source, code: error.code, message: error.message }
  }
  return { name, source, code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) }
}

async function readProjectTeamSpecs(projectRoot: string): Promise<readonly RawProjectSpec[]> {
  const teamsDir = join(projectRoot, ".omo", "teams")
  let entries: Dirent[]
  try {
    entries = await readdir(teamsDir, { withFileTypes: true, encoding: "utf8" })
  } catch {
    return []
  }

  const candidates: RawProjectSpec[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const rawText = await readFile(resolveProjectTeamSpecPath(projectRoot, entry.name), "utf8")
      candidates.push({ name: entry.name, rawText })
    } catch {
      continue
    }
  }
  return candidates
}

function ingest(
  name: string,
  source: TeamSpecSource,
  rawSpec: unknown,
  ports: SenpiTeamMemberPorts,
  teams: TeamRegistryEntry[],
  errors: TeamRegistryError[],
): void {
  try {
    const spec = normalizeSenpiTeamSpec(rawSpec, name)
    validateSenpiTeamMembers(spec, ports)
    teams.push({ name, source, spec })
  } catch (error) {
    errors.push(toRegistryError(name, source, error))
  }
}

/**
 * Loads named team specs from the two project-scoped sources: the raw `omo.json` `teams` section and
 * the omo-compatible `<projectRoot>/.omo/teams/<name>/config.json` directory specs. The project
 * directory beats `omo.json` on a name collision. Each candidate is normalized + parsed via
 * `normalizeSenpiTeamSpec` (team-core normalizer + schema, never `validateSpec`) and checked by the
 * senpi-local member validator; a failing team is recorded in `errors` and spawns zero members.
 */
export async function loadTeamRegistry(input: LoadTeamRegistryInput): Promise<LoadTeamRegistryResult> {
  const teams: TeamRegistryEntry[] = []
  const errors: TeamRegistryError[] = []

  const projectSpecs = await readProjectTeamSpecs(input.projectRoot)
  const projectNames = new Set(projectSpecs.map((candidate) => candidate.name))

  for (const candidate of projectSpecs) {
    let rawSpec: unknown
    try {
      rawSpec = JSON.parse(candidate.rawText)
    } catch (error) {
      errors.push({
        name: candidate.name,
        source: "project",
        code: "INVALID_JSON",
        message: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    ingest(candidate.name, "project", rawSpec, input.ports, teams, errors)
  }

  const omoTeams = input.omoTeams ?? {}
  for (const name of Object.keys(omoTeams)) {
    if (projectNames.has(name)) continue
    ingest(name, "omo-json", Object.hasOwn(omoTeams, name) ? omoTeams[name] : undefined, input.ports, teams, errors)
  }

  return { teams, errors }
}
