import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import type { ChildPlanner, ManagerStartSpec, PlanResolution } from "./types"

// An explicit pin resolves through senpi's resolver, read synchronously from the lazy barrel (#9722),
// so a cold process's first spawn must load it before planning.
export async function planWithWarmBarrel(planner: ChildPlanner, spec: ManagerStartSpec): Promise<PlanResolution> {
  await loadSenpiBarrel()
  return planner(spec)
}
