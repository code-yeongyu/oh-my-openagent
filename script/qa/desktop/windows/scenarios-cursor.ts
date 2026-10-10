// Cursor placement by the engine process itself (#9095): a desktop-target `moveMouse` (no window
// takeover and no cursor restore) must leave the cursor exactly on the requested point, as read back by
// the independent pointer probe. This is where a SendInput absolute move that Win32 accepts but never
// applies shows up without any window in the way.
import { asObject, errorCode } from "./engine"
import { type Point, probe, probeHostsUntil } from "./pointer-kit"
import { type Scenario, withEngine } from "./scenario-kit"

const PARKED: Point = { x: 40, y: 40 }

export const desktopMoveLands: Scenario = {
  name: "desktop-move-lands",
  run: (context) =>
    withEngine(context, async (engine) => {
      await engine.activate()
      const frame = asObject(await engine.result("capture", { target: "desktop" }))
      const width = Number(frame.width)
      const height = Number(frame.height)
      const before = await probe([], PARKED)
      const screen = before.virtualScreen
      const requested = { x: Math.floor(width * 0.6), y: Math.floor(height * 0.4) }
      const intended = {
        x: screen.left + Math.floor(((screen.right - screen.left) * requested.x) / width),
        y: screen.top + Math.floor(((screen.bottom - screen.top) * requested.y) / height),
      }
      const frameId = typeof frame.frameId === "string" ? frame.frameId : null
      const reply = await engine.exec("moveMouse", {
        target: "desktop",
        ...requested,
        frameId,
        opts: { deliveryMode: "background" },
      })
      const after = await probeHostsUntil([], (seen) => seen.cursor.x !== PARKED.x || seen.cursor.y !== PARKED.y)
      const landed = Math.abs(after.cursor.x - intended.x) <= 1 && Math.abs(after.cursor.y - intended.y) <= 1
      const checks = [
        ["parked-before", before.cursor.x === PARKED.x && before.cursor.y === PARKED.y],
        ["move-succeeded", reply.error === undefined],
        ["cursor-on-requested-point", landed],
      ] as const
      const failed = checks.find(([, passed]) => !passed)
      return {
        pass: failed === undefined,
        ...(failed === undefined ? {} : { reason: failed[0] }),
        facts: {
          frame: { width, height },
          requested,
          intended,
          cursorAfter: after.cursor,
          moveError: errorCode(reply) ?? null,
          moveMessage: reply.error?.message ?? null,
          checks: Object.fromEntries(checks),
        },
        observer: { before: before.raw, after: after.raw },
      }
    }),
}
