import type { PermissionDeniedData } from "@oh-my-opencode/senpi-desktop-protocol"
import type { StepScope } from "@oh-my-opencode/senpi-desktop-service"
import type { ComputerAction, ScreenshotBounds } from "./cua-actions"

export interface StepOutcome {
  readonly index: number
  readonly action: string
  readonly status: "success" | "error"
  readonly code?: string
  readonly message?: string
  readonly permission?: PermissionDeniedData
  readonly reason?: string | null
}

export interface ActionsOutcome {
  readonly steps: readonly StepOutcome[]
  readonly bounds: ScreenshotBounds | null
  readonly failedIndex: number | null
}

type Point = readonly [number, number]

function pointsOf(action: ComputerAction): readonly Point[] {
  if (action.action === "drag") {
    return [
      [action.x, action.y],
      [action.to_x, action.to_y],
    ]
  }
  return "x" in action ? [[action.x, action.y]] : []
}

/** The step record of a failure, read off the error the way an engine, run, or plain error carries its code. */
function failedStep(index: number, action: string, error: unknown): StepOutcome {
  const data = Reflect.get(Object(error), "data")
  const code =
    Reflect.get(Object(data), "code") ?? Reflect.get(Object(error), "reason") ?? Reflect.get(Object(error), "name")
  return {
    index,
    action,
    status: "error",
    code: String(code ?? "Error"),
    message: String(Reflect.get(Object(error), "message") ?? error),
    permission: Reflect.get(Object(data), "permission"),
    reason: Reflect.get(Object(data), "reason"),
  }
}

async function perform(scope: StepScope, action: ComputerAction, shoot: () => Promise<void>): Promise<void> {
  const { desktop } = scope
  const button = "button" in action && action.button !== undefined ? { button: action.button } : {}
  switch (action.action) {
    case "screenshot":
      return shoot()
    case "click":
      return desktop.click(action.x, action.y, button)
    case "double_click":
      return desktop.doubleClick(action.x, action.y, button)
    case "move":
      return desktop.move(action.x, action.y)
    case "drag":
      return desktop.drag(
        [
          [action.x, action.y],
          [action.to_x, action.to_y],
        ],
        button,
      )
    case "scroll":
      return desktop.scroll(action.x, action.y, { dx: action.scroll_x, dy: action.scroll_y })
    case "type":
      return desktop.type(action.text)
    case "keypress":
      return desktop.press(action.keys)
    case "wait":
      return scope.sleep(action.ms)
  }
}

/**
 * Executes `actions` in order through the desktop facade and halts at the first failure. Pointer coordinates are
 * checked against the latest screenshot before any input, and an in-batch screenshot becomes the frame for the
 * actions after it. Every step records its index, action, and outcome.
 */
export async function runActions(
  scope: StepScope,
  actions: readonly ComputerAction[],
  initialBounds: ScreenshotBounds | null,
): Promise<ActionsOutcome> {
  let bounds = initialBounds
  const steps: StepOutcome[] = []
  const shoot = async () => {
    const shot = await scope.desktop.screenshot()
    bounds = { width: shot.width, height: shot.height }
  }
  for (const [index, action] of actions.entries()) {
    const frame = bounds
    const off =
      frame === null
        ? undefined
        : pointsOf(action).find(([x, y]) => x < 0 || y < 0 || x >= frame.width || y >= frame.height)
    if (frame !== null && off !== undefined) {
      const message = `${action.action} coordinates (${off[0]},${off[1]}) are outside the latest screenshot bounds ${frame.width}x${frame.height}.`
      steps.push({ index, action: action.action, status: "error", code: "COMPUTER_COORD_INVALID", message })
      return { steps, bounds, failedIndex: index }
    }
    try {
      await perform(scope, action, shoot)
      if (action.include_screenshot === true && action.action !== "screenshot") await shoot()
      steps.push({ index, action: action.action, status: "success" })
    } catch (error) {
      steps.push(failedStep(index, action.action, error))
      return { steps, bounds, failedIndex: index }
    }
  }
  return { steps, bounds, failedIndex: null }
}
