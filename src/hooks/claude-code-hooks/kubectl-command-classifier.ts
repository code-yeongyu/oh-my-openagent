export interface KubectlCommandClassification {
  isKubectl: boolean
  isDangerous: boolean
  isContextSwitch: boolean
  matchedPattern?: string
}

export function classifyKubectlCommand(command: string): KubectlCommandClassification {
  const trimmed = command.trim()

  if (!trimmed) {
    return { isKubectl: false, isDangerous: false, isContextSwitch: false }
  }

  // Check if command starts with kubectl, kubectx, or kubens (after stripping comments and quotes)
  const kubectlMatch = extractKubectlCommand(trimmed)
  if (!kubectlMatch) {
    return { isKubectl: false, isDangerous: false, isContextSwitch: false }
  }

  const subcommand = kubectlMatch.subcommand
  const fullCommand = kubectlMatch.fullCommand

  // Check for context switching operations
  const contextSwitchPattern = detectContextSwitch(subcommand, fullCommand)
  if (contextSwitchPattern !== null) {
    return {
      isKubectl: true,
      isDangerous: false,
      isContextSwitch: true,
      matchedPattern: contextSwitchPattern,
    }
  }

  // Check for dangerous operations
  const dangerousPattern = detectDangerousOperation(subcommand, fullCommand)

  return {
    isKubectl: true,
    isDangerous: dangerousPattern !== null,
    isContextSwitch: false,
    matchedPattern: dangerousPattern ?? undefined,
  }
}

interface KubectlMatch {
  subcommand: string
  fullCommand: string
}

function extractKubectlCommand(command: string): KubectlMatch | null {
  // Skip comments
  if (command.startsWith("#")) {
    return null
  }

  // Skip quoted strings
  if (command.startsWith('"') || command.startsWith("'")) {
    return null
  }

  // Handle environment variables (e.g., KUBECONFIG=/path kubectl get pods)
  let workingCommand = command
  const envVarMatch = command.match(/^([A-Z_]+=[^\s]+\s+)+(.+)$/)
  if (envVarMatch) {
    workingCommand = envVarMatch[2]
  }

  // Extract the executable part (before pipes, redirects, etc.)
  const executablePart = workingCommand.split(/[|&><;]/, 1)[0].trim()

  // Match kubectl command with optional path and .exe extension
  const kubectlPattern = /^(?:.*[/\\])?kubectl(?:\.exe)?\s+(.*)$/i
  const kubectlMatch = executablePart.match(kubectlPattern)

  if (kubectlMatch) {
    const args = kubectlMatch[1].trim()
    const subcommandMatch = args.match(/^(\S+)/)
    const subcommand = subcommandMatch ? subcommandMatch[1] : ""

    return {
      subcommand: subcommand.toLowerCase(),
      fullCommand: args,
    }
  }

  // Match kubectx command (context switching tool)
  const kubectxPattern = /^(?:.*[/\\])?kubectx(?:\.exe)?(\s+(.*))?$/i
  const kubectxMatch = executablePart.match(kubectxPattern)

  if (kubectxMatch) {
    const args = kubectxMatch[2]?.trim() || ""
    return {
      subcommand: "kubectx",
      fullCommand: args,
    }
  }

  // Match kubens command (namespace switching tool)
  const kubensPattern = /^(?:.*[/\\])?kubens(?:\.exe)?(\s+(.*))?$/i
  const kubensMatch = executablePart.match(kubensPattern)

  if (kubensMatch) {
    const args = kubensMatch[2]?.trim() || ""
    return {
      subcommand: "kubens",
      fullCommand: args,
    }
  }

  // Match helm command
  const helmPattern = /^(?:.*[/\\])?helm(?:\.exe)?\s+(.*)$/i
  const helmMatch = executablePart.match(helmPattern)

  if (helmMatch) {
    const args = helmMatch[1].trim()
    const subcommandMatch = args.match(/^(\S+)/)
    const subcommand = subcommandMatch ? subcommandMatch[1] : ""

    return {
      subcommand: `helm-${subcommand.toLowerCase()}`,
      fullCommand: args,
    }
  }

  return null
}

function detectContextSwitch(subcommand: string, fullCommand: string): string | null {
  // Context switching operations: kubectl --context, kubectl config use-context, kubectx

  // Handle kubectx command (with or without arguments)
  if (subcommand === "kubectx") {
    // kubectx without arguments lists contexts (read operation)
    // kubectx <name> switches context (context switch)
    if (fullCommand.length > 0 && !fullCommand.startsWith("-")) {
      return "kubectx (context switch)"
    }
    return null
  }

  // Handle kubens command
  if (subcommand === "kubens") {
    // kubens switches namespace, which affects context
    if (fullCommand.length > 0 && !fullCommand.startsWith("-")) {
      return "kubens (namespace switch)"
    }
    return null
  }

  const contextSwitchPatterns: Array<[RegExp, string]> = [
    // kubectl --context flag (any command with --context)
    [/--context\s+\S+/, "kubectl --context"],

    // kubectl config use-context
    [/^config\s+use-context\b/, "kubectl config use-context"],
  ]

  for (const [pattern, name] of contextSwitchPatterns) {
    if (pattern.test(fullCommand)) {
      return name
    }
  }

  return null
}

function isDryRun(fullCommand: string): boolean {
  if (/--dry-run=none\b/.test(fullCommand)) return false
  return /--dry-run\b/.test(fullCommand)
}

function detectDangerousOperation(subcommand: string, fullCommand: string): string | null {
  // Dangerous operations: scale, delete, apply, create, patch, edit, rollout restart, drain, cordon, uncordon, exec, port-forward, proxy

  const dangerousPatterns: Array<[RegExp, string]> = [
    // Helm dangerous operations (check first to avoid conflicts with kubectl patterns)
    [/^helm-install\b/, "helm install"],
    [/^helm-upgrade\b/, "helm upgrade"],
    [/^helm-uninstall\b/, "helm uninstall"],
    [/^helm-delete\b/, "helm delete"],
    [/^helm-rollback\b/, "helm rollback"],
    [/^helm-test\b/, "helm test"],

    // Resource scaling
    [/^scale\b/, "kubectl scale"],

    // Resource deletion
    [/^delete\b/, "kubectl delete"],

    // Resource creation/modification
    [/^apply\b/, "kubectl apply"],
    [/^create\b/, "kubectl create"],
    [/^patch\b/, "kubectl patch"],
    [/^edit\b/, "kubectl edit"],

    // Rollout operations
    [/^rollout\s+restart\b/, "kubectl rollout restart"],
    [/^rollout\s+undo\b/, "kubectl rollout undo"],

    // Node operations
    [/^drain\b/, "kubectl drain"],
    [/^cordon\b/, "kubectl cordon"],
    [/^uncordon\b/, "kubectl uncordon"],

    // Potentially dangerous operations
    [/^exec\b/, "kubectl exec"],
    [/^proxy\b/, "kubectl proxy"],
    [/^cp\b/, "kubectl cp"],
    [/^attach\b/, "kubectl attach"],

    // Config write operations (specific patterns first)
    [/^config\s+set-context\b/, "kubectl config set-context"],
    [/^config\s+set-cluster\b/, "kubectl config set-cluster"],
    [/^config\s+set-credentials\b/, "kubectl config set-credentials"],
    [/^config\s+set\b/, "kubectl config set"],

    // Label/annotation modifications
    [/^label\b/, "kubectl label"],
    [/^annotate\b/, "kubectl annotate"],

    // Taint operations
    [/^taint\b/, "kubectl taint"],

    // Replace operations
    [/^replace\b/, "kubectl replace"],

    // Run operations (creates resources)
    [/^run\b/, "kubectl run"],

    // Expose operations (creates services)
    [/^expose\b/, "kubectl expose"],

    // Set operations (modifies resources)
    [/^set\b/, "kubectl set"],

    // Autoscale operations
    [/^autoscale\b/, "kubectl autoscale"],

    // Certificate operations
    [/^certificate\s+approve\b/, "kubectl certificate approve"],
    [/^certificate\s+deny\b/, "kubectl certificate deny"],

    // Debug operations (creates ephemeral containers)
    [/^debug\b/, "kubectl debug"],
  ]

  for (const [pattern, name] of dangerousPatterns) {
    if (pattern.test(fullCommand) || pattern.test(subcommand)) {
      if (isDryRun(fullCommand)) {
        return null
      }
      return name
    }
  }

  return null
}
