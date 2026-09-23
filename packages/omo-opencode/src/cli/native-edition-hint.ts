import type { InstallConfig } from "./types"

export const NATIVE_EDITION_INSTALL_COMMAND = "bun add -g omo-ai@beta"
export const NATIVE_EDITION_GUIDE_URL =
  "https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/installation.md#omo-native-beta-omo-via-omo-ai"
export const NATIVE_EDITION_HINT_TITLE = "OmO Native (beta)"

export type NativeEditionHintPaint = {
  readonly command: (text: string) => string
  readonly link: (text: string) => string
}

const PLAIN_PAINT: NativeEditionHintPaint = {
  command: (text) => text,
  link: (text) => text,
}

export function shouldShowNativeEditionHint(
  config: Pick<InstallConfig, "hasNative" | "hasNativeDev">,
): boolean {
  return !config.hasNative && !config.hasNativeDev
}

export function nativeEditionHintLines(paint: NativeEditionHintPaint = PLAIN_PAINT): readonly string[] {
  return [
    `omo also ships as OmO Native: the same omo as one ${paint.command("omo")} command, with no OpenCode host required.`,
    `Try it next to this install: ${paint.command(NATIVE_EDITION_INSTALL_COMMAND)}, then run ${paint.command("omo")}.`,
    "This install keeps working as-is.",
    `Guide: ${paint.link(NATIVE_EDITION_GUIDE_URL)}`,
  ]
}
