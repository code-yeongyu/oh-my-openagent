import noFixedSleep from "./no-fixed-sleep.ts"
import noFlakeMasking from "./no-flake-masking.ts"
import noModuleMock from "./no-module-mock.ts"

export default {
  meta: { name: "omo-testing" },
  rules: {
    "no-fixed-sleep": noFixedSleep,
    "no-flake-masking": noFlakeMasking,
    "no-module-mock": noModuleMock,
  },
}
