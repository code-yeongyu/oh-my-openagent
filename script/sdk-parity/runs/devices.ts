import { scenarioRuns } from "../fakes/setup"

// desktop-launch states no `given`; the desktop launch is the fixture fact its refusal is about.
export const runs = scenarioRuns(["devices.list", "devices.rename"], {
  "devices.list/desktop-launch": { desktopLaunch: true },
})
