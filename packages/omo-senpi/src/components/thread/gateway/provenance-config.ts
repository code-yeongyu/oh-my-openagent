import { loadSenpiOmoConfig } from "../../config-resolution"
import type { ProvenanceWorkspaces } from "./provenance-resolver"

/** The sender's `provenance.workspaces` from its profile-selected omo.json. Only the extension bundle imports this. */
export function loadProvenanceWorkspaces(cwd: string, env: Readonly<Record<string, string | undefined>>): ProvenanceWorkspaces {
  return loadSenpiOmoConfig({ cwd, env }).config.provenance?.workspaces ?? []
}
