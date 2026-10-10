// Calibration fragments for preset variants that share a base prompt body. Each fragment is
// prepended to the base body by atlas-preset-contract; the authored prose for a preset lives
// exactly once, here or in its base file - never as a full-file copy.

export type PresetCalibrationFragment = {
  readonly tag: string
  readonly line: string
}

function renderFragment(fragment: PresetCalibrationFragment): string {
  return `<${fragment.tag}>\n${fragment.line}\n</${fragment.tag}>\n\n`
}

const DEEPSEEK_V4_1_FLASH: PresetCalibrationFragment = {
  tag: "deepseek_v4_1_flash_specific_calibration",
  line: "DeepSeek V4.1 Flash calibration: improved instruction adherence over V4 Flash; keep the full 6-section delegation structure regardless.",
}

const DEEPSEEK_V4_FLASH: PresetCalibrationFragment = {
  tag: "deepseek_v4_flash_specific_calibration",
  line: "DeepSeek V4 Flash calibration: concise tool-call style; verify with your own tools and keep delegation prompts fully specified — V4 Flash follows terse prompts literally.",
}

const DEEPSEEK_V4_FLASH_0731: PresetCalibrationFragment = {
  tag: "deepseek_v4_flash_0731_specific_calibration",
  line: "DeepSeek V4 Flash (0731 dated snapshot) calibration: same prompting contract as V4 Flash; the dated id resolves before the generic flash alias.",
}

const DEEPSEEK_V4_PRO: PresetCalibrationFragment = {
  tag: "deepseek_v4_pro_specific_calibration",
  line: "DeepSeek V4 Pro calibration: strong long-context reasoning; counter any tendency to end turns early — run the full verification protocol on every delegation.",
}

const GROK_4_5: PresetCalibrationFragment = {
  tag: "grok_4_5_specific_calibration",
  line: "Grok 4.5 calibration: direct execution style; counter terse-answer bias by requiring the full delegation + verification structure.",
}

const GROK_4_6: PresetCalibrationFragment = {
  tag: "grok_4_6_specific_calibration",
  line: "Grok 4.6 calibration: as 4.5 with stronger tool use; keep parallel fan-out explicit.",
}

const GROK_4_7: PresetCalibrationFragment = {
  tag: "grok_4_7_specific_calibration",
  line: "Grok 4.7 calibration: tuned core; as 4.6, plus never skip the post-delegation plan-checkbox step.",
}
const HAIKU_5_5: PresetCalibrationFragment = {
  tag: "haiku_5_5_specific_calibration",
  line: "Haiku 5.5 calibration: fast lightweight execution; do not hand the task back while asked-for work is still owed — finish the delegation verification loop before ending the turn.",
}


export const ATLAS_PRESET_FRAGMENTS = {
  "deepseek-v4-1-flash": renderFragment(DEEPSEEK_V4_1_FLASH),
  "deepseek-v4-flash": renderFragment(DEEPSEEK_V4_FLASH),
  "deepseek-v4-flash-0731": renderFragment(DEEPSEEK_V4_FLASH_0731),
  "deepseek-v4-pro": renderFragment(DEEPSEEK_V4_PRO),
  "haiku-5-5": renderFragment(HAIKU_5_5),
  "grok-4.5": renderFragment(GROK_4_5),
  "grok-4.6": renderFragment(GROK_4_6),
  "grok-4.7": renderFragment(GROK_4_7),
} as const
