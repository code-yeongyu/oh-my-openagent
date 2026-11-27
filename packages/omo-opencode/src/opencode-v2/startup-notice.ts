import { NATIVE_EDITION_GUIDE_URL, NATIVE_EDITION_INSTALL_COMMAND } from "../cli/native-edition-hint"

export const OPENCODE_V2_NOTICE_TITLE = "Oh My OpenAgent on OpenCode 2"

export const OPENCODE_V2_NOTICE_MESSAGE = [
  "OpenCode 2 support is limited: the plugin loads, but its agents, tools and hooks are not active here.",
  `For the full omo, use OmO Native: run ${NATIVE_EDITION_INSTALL_COMMAND}, then omo.`,
  `Guide: ${NATIVE_EDITION_GUIDE_URL}`,
].join("\n")

export const OPENCODE_V2_NOTICE_DURATION_MS = 15_000
