import type { ReasonArgueRequest } from "./client/client-types"
import type { BashCommandFeatures, WriteTargetFeatures } from "./destructive-feature-extractor"

const BLOCK_CONCLUSION = "block_action"

interface BuildResult {
  theory: ReasonArgueRequest["theory"]
  conclusion: string
}

function premise(formula: string, kind: "ordinary" | "axiom" | "assumption" = "ordinary") {
  return { formula, kind }
}

function strictRule(id: string, antecedents: string[], consequent: string) {
  return { id, antecedents, consequent }
}

function defeasibleRule(id: string, antecedents: string[], consequent: string) {
  return { id, antecedents, consequent }
}

export function buildBashDestructiveTheory(features: BashCommandFeatures): BuildResult {
  const premises: Array<{ formula: string; kind: string }> = []
  const strictRules: Array<{ id: string; antecedents: string[]; consequent: string }> = []
  const defeasibleRules: Array<{ id: string; antecedents: string[]; consequent: string }> = []

  premises.push(premise("bash_invocation", "ordinary"))
  if (features.verb.length > 0) premises.push(premise(`verb(${features.verb})`, "ordinary"))
  if (features.has_recursive_flag) premises.push(premise("flag_recursive", "ordinary"))
  if (features.has_force_flag) premises.push(premise("flag_force", "ordinary"))
  if (features.targets_root) premises.push(premise("target_root", "ordinary"))
  if (features.targets_absolute_path) premises.push(premise("target_absolute_path", "ordinary"))
  if (features.targets_device) premises.push(premise("target_device_path", "ordinary"))
  if (features.targets_system_path) premises.push(premise("target_system_path", "ordinary"))
  if (features.is_fork_bomb) premises.push(premise("is_fork_bomb", "axiom"))
  if (features.is_kill_init) premises.push(premise("is_kill_init", "axiom"))
  if (features.is_disk_format) premises.push(premise("is_disk_format", "axiom"))
  if (features.is_raw_disk_write) premises.push(premise("is_raw_disk_write", "axiom"))
  if (features.is_system_shutdown) premises.push(premise("is_system_shutdown", "axiom"))

  strictRules.push(strictRule("sr-fork-bomb", ["is_fork_bomb"], BLOCK_CONCLUSION))
  strictRules.push(strictRule("sr-kill-init", ["is_kill_init"], BLOCK_CONCLUSION))
  strictRules.push(strictRule("sr-disk-format", ["is_disk_format"], BLOCK_CONCLUSION))
  strictRules.push(strictRule("sr-raw-disk-write", ["is_raw_disk_write"], BLOCK_CONCLUSION))
  strictRules.push(strictRule("sr-system-shutdown", ["is_system_shutdown"], BLOCK_CONCLUSION))
  strictRules.push(strictRule(
    "sr-rm-recursive-root",
    ["verb(rm)", "flag_recursive", "target_root"],
    BLOCK_CONCLUSION,
  ))
  strictRules.push(strictRule(
    "sr-rm-system-path",
    ["verb(rm)", "target_system_path"],
    BLOCK_CONCLUSION,
  ))
  strictRules.push(strictRule(
    "sr-rm-absolute-path",
    ["verb(rm)", "target_absolute_path"],
    BLOCK_CONCLUSION,
  ))
  strictRules.push(strictRule(
    "sr-chmod-system",
    ["verb(chmod)", "target_system_path"],
    BLOCK_CONCLUSION,
  ))
  strictRules.push(strictRule(
    "sr-chmod-recursive-root",
    ["verb(chmod)", "flag_recursive", "target_root"],
    BLOCK_CONCLUSION,
  ))

  defeasibleRules.push(defeasibleRule(
    "dr-chmod-recursive",
    ["verb(chmod)", "flag_recursive"],
    BLOCK_CONCLUSION,
  ))

  return {
    theory: {
      premises,
      strict_rules: strictRules,
      defeasible_rules: defeasibleRules,
      preferences: [],
      classical_negation: true,
    },
    conclusion: BLOCK_CONCLUSION,
  }
}

export function buildWriteDestructiveTheory(features: WriteTargetFeatures): BuildResult {
  const premises: Array<{ formula: string; kind: string }> = []
  const strictRules: Array<{ id: string; antecedents: string[]; consequent: string }> = []
  const defeasibleRules: Array<{ id: string; antecedents: string[]; consequent: string }> = []

  premises.push(premise("write_invocation", "ordinary"))
  if (features.is_absolute) premises.push(premise("path_absolute", "ordinary"))
  if (features.is_dotenv) premises.push(premise("path_dotenv", "ordinary"))
  if (features.is_ssh_dir) premises.push(premise("path_ssh_dir", "ordinary"))
  if (features.is_credential_name) premises.push(premise("path_credential_name", "ordinary"))
  if (features.is_etc) premises.push(premise("path_etc", "ordinary"))
  if (features.is_usr) premises.push(premise("path_usr", "ordinary"))
  if (features.is_bin) premises.push(premise("path_bin", "ordinary"))
  if (features.is_sbin) premises.push(premise("path_sbin", "ordinary"))
  if (features.is_node_modules) premises.push(premise("path_node_modules", "ordinary"))
  if (features.is_shell_rc) premises.push(premise("path_shell_rc", "ordinary"))

  strictRules.push(strictRule("sr-write-dotenv", ["path_dotenv"], BLOCK_CONCLUSION))
  strictRules.push(strictRule("sr-write-ssh", ["path_ssh_dir"], BLOCK_CONCLUSION))
  strictRules.push(strictRule("sr-write-credential", ["path_credential_name"], BLOCK_CONCLUSION))
  strictRules.push(strictRule("sr-write-etc", ["path_etc"], BLOCK_CONCLUSION))
  strictRules.push(strictRule("sr-write-usr", ["path_usr"], BLOCK_CONCLUSION))
  strictRules.push(strictRule("sr-write-sbin", ["path_sbin"], BLOCK_CONCLUSION))

  defeasibleRules.push(defeasibleRule("dr-write-bin", ["path_bin"], BLOCK_CONCLUSION))
  defeasibleRules.push(defeasibleRule("dr-write-node-modules", ["path_node_modules"], BLOCK_CONCLUSION))
  defeasibleRules.push(defeasibleRule("dr-write-shell-rc", ["path_shell_rc"], BLOCK_CONCLUSION))

  return {
    theory: {
      premises,
      strict_rules: strictRules,
      defeasible_rules: defeasibleRules,
      preferences: [],
      classical_negation: true,
    },
    conclusion: BLOCK_CONCLUSION,
  }
}

export const BLOCK_CONCLUSION_ATOM = BLOCK_CONCLUSION
