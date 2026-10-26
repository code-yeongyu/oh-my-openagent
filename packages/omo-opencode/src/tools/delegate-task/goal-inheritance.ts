import { createGoalController } from "../../hooks/goal/controller"

export function inheritGoalToChild(args: {
  readonly projectDir: string
  readonly parentSessionID: string
  readonly childSessionID: string
}): boolean {
  try {
    const controller = createGoalController({ projectDir: args.projectDir })
    const parent = controller.getGoal(args.parentSessionID)
    if (parent === null || parent.status !== "active") return false
    const remaining = Math.max(1, parent.maxIterations - parent.iteration)
    controller.setGoal(args.childSessionID, parent.objective, {
      parentGoalID: parent.id,
      rootGoalID: parent.rootGoalID ?? parent.id,
      maxIterations: remaining,
    })
    controller.addChildSession(args.parentSessionID, args.childSessionID)
    return true
  } catch {
    return false
  }
}