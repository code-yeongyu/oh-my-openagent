import { scenarioRuns } from "../fakes/setup"

export const runs = scenarioRuns([
  "threads.extensions.call",
  "threads.extensions.register",
  "threads.locate",
  "threads.release",
  "threads.rename",
  "threads.send",
  "threads.unload",
])
