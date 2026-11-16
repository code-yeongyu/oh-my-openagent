// A-IS-62 item 5 on X11: no consent file and no view: the stop path reads deaf `chord-unarmable` and nothing is clicked.
import { noConsentFile } from "../lib/consent-negative.ts"
import type { Checked, Context, Scenario } from "../lib/scenario.ts"

export const consentNoFile: Scenario = {
  name: "consent-no-file",
  admit: "os",
  sessions: ["xvfb"],
  requires: ["xdotool"],
  run(ctx: Context): Promise<Checked> {
    return noConsentFile(ctx, undefined)
  },
}
