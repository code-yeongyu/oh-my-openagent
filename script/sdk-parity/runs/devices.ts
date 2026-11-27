import { scenarioRuns } from "../fakes/setup"

// desktop-launch states no `given`; the desktop launch is the fixture fact its refusal is about.
export const runs = scenarioRuns(["devices.list", "devices.rename", "account.devices"], {
  "devices.list/desktop-launch": { desktopLaunch: true },
})
