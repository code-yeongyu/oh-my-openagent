import noFixedSleep from "./no-fixed-sleep.ts"
import noFlakeMasking from "./no-flake-masking.ts"

export default {
  meta: { name: "omo-testing" },
  rules: {
    "no-fixed-sleep": noFixedSleep,
    "no-flake-masking": noFlakeMasking,
  },
}
