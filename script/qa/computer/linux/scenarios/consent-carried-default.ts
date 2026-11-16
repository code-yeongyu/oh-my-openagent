// A-IS-62 item 5 on X11: no consent file, and `stopPath.start` carries the Linux default chord: it is not accepted as equal - nothing is compared, armed or clicked.
import { noConsentFile } from "../lib/consent-negative.ts"
import type { Checked, Context, Scenario } from "../lib/scenario.ts"

export const consentCarriedDefault: Scenario = {
  name: "consent-carried-default",
  admit: "os",
  sessions: ["xvfb"],
  requires: ["xdotool"],
  run(ctx: Context): Promise<Checked> {
    return noConsentFile(ctx, "ctrl+alt+shift+escape")
  },
}
