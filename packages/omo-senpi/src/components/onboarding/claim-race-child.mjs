import { claimOnboarding } from "./state.ts"

const stateDir = process.argv[2]
if (!stateDir) {
  process.exit(2)
}

process.send("ready")

process.on("message", () => {
  const won = claimOnboarding(stateDir)
  process.exit(won ? 0 : 1)
})
