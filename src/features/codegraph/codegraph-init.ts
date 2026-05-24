import type { CodeGraphConfig } from "../../config/schema/codegraph"
import { CodeGraphManager } from "./codegraph-manager"
export interface InitializeCodeGraphParams { directory: string; config: CodeGraphConfig }
export async function initializeCodeGraph(p: InitializeCodeGraphParams): Promise<CodeGraphManager> {
  const m = new CodeGraphManager({ directory: p.directory, config: p.config })
  if (!(await m.initialize()) && p.config.auto_init) { if (await m.ensureIndex()) await m.initialize() }
  return m
}
