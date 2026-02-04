import { describe, test, expect } from "bun:test"
import { enforceKubectlWriteRestriction } from "./kubectl-write-enforcement"
import type { PreToolUseContext } from "./pre-tool-use"
import type { OhMyOpenCodeConfig } from "../../config/schema"

describe("enforceKubectlWriteRestriction", () => {
  describe("non-kubectl commands", () => {
    test("should allow non-kubectl command (ls)", () => {
      //#given - non-kubectl command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "ls -la" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow
      expect(result.blocked).toBe(false)
    })

    test("should allow tool that is not bash/mcp_bash/interactive_bash (Read)", () => {
      //#given - different tool (Read)
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "Read",
        toolInput: { filePath: "/test/file.ts" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow (not a bash command)
      expect(result.blocked).toBe(false)
    })
  })

  describe("kubectl safe read commands", () => {
    test("should allow kubectl get pods by non-k8s-owner", () => {
      //#given - kubectl read command from non-k8s-owner
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl get pods" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow (read command)
      expect(result.blocked).toBe(false)
    })

    test("should allow kubectl describe deployment by non-k8s-owner", () => {
      //#given - kubectl read command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl describe deployment my-app" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow (read command)
      expect(result.blocked).toBe(false)
    })
  })

  describe("kubectl dangerous operations - bash tool", () => {
    test("should block kubectl delete pod by non-k8s-owner (bash)", () => {
      //#given - kubectl delete from non-k8s-owner
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl delete pod my-pod" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Kubectl dangerous operation blocked")
      expect(result.reason).toContain("k8s-owner")
    })

    test("should block kubectl apply -f by non-k8s-owner (bash)", () => {
      //#given - kubectl apply from non-k8s-owner
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl apply -f deployment.yaml" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Kubectl dangerous operation blocked")
    })

    test("should block kubectl scale by non-k8s-owner (bash)", () => {
      //#given - kubectl scale from non-k8s-owner
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl scale deployment/my-app --replicas=3" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Kubectl dangerous operation blocked")
    })

    test("should allow kubectl delete pod by k8s-owner (bash)", () => {
      //#given - kubectl delete from k8s-owner
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl delete pod my-pod" },
        cwd: "/test",
        agent: "k8s-owner",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow
      expect(result.blocked).toBe(false)
    })
  })

  describe("kubectl dangerous operations - mcp_bash tool", () => {
    test("should block kubectl apply by non-k8s-owner (mcp_bash)", () => {
      //#given - kubectl apply from non-k8s-owner via mcp_bash
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "mcp_bash",
        toolInput: { command: "kubectl apply -f config.yaml" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Kubectl dangerous operation blocked")
    })

    test("should allow kubectl apply by k8s-owner (mcp_bash)", () => {
      //#given - kubectl apply from k8s-owner via mcp_bash
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "mcp_bash",
        toolInput: { command: "kubectl apply -f config.yaml" },
        cwd: "/test",
        agent: "k8s-owner",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow
      expect(result.blocked).toBe(false)
    })
  })

  describe("backward compatibility - PascalCase Bash", () => {
    test("should block kubectl delete by non-owner (Bash - PascalCase)", () => {
      //#given - kubectl delete from non-k8s-owner via Bash (PascalCase)
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "Bash",
        toolInput: { command: "kubectl delete pod my-pod" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should block (backward compat)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Kubectl dangerous operation blocked")
    })
  })

  describe("kubectl dangerous operations - interactive_bash tool", () => {
    test("should block kubectl apply by non-owner (interactive_bash)", () => {
      //#given - kubectl apply from non-k8s-owner via interactive_bash
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "interactive_bash",
        toolInput: { tmux_command: "kubectl apply -f deployment.yaml" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Kubectl dangerous operation blocked")
    })

    test("should allow kubectl get pods (interactive_bash)", () => {
      //#given - kubectl read command via interactive_bash
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "interactive_bash",
        toolInput: { tmux_command: "kubectl get pods" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow (read command)
      expect(result.blocked).toBe(false)
    })
  })

  describe("context switch operations", () => {
    test("should block kubectl config use-context by non-owner", () => {
      //#given - kubectl context switch from non-k8s-owner
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl config use-context prd-mss-cluster" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Kubectl context switch blocked")
      expect(result.reason).toContain("k8s-owner")
    })

    test("should allow kubectl config use-context by k8s-owner", () => {
      //#given - kubectl context switch from k8s-owner
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl config use-context prd-mss-cluster" },
        cwd: "/test",
        agent: "k8s-owner",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow
      expect(result.blocked).toBe(false)
    })
  })

  describe("helm operations", () => {
    test("should block helm install by non-k8s-owner", () => {
      //#given - helm install from non-k8s-owner
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "helm install my-release my-chart/" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Kubectl dangerous operation blocked")
    })

    test("should allow helm list by non-k8s-owner (safe helm command)", () => {
      //#given - helm list (read command) from non-k8s-owner
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "helm list" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow (safe helm command)
      expect(result.blocked).toBe(false)
    })
  })

  describe("--dry-run flag safety override", () => {
    test("should allow kubectl apply --dry-run=client by non-owner", () => {
      //#given - kubectl apply with --dry-run=client (safe override)
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl apply -f file.yaml --dry-run=client" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow (dry-run makes it safe)
      expect(result.blocked).toBe(false)
    })
  })

  describe("no agent (undefined)", () => {
    test("should block dangerous kubectl by undefined agent", () => {
      //#given - kubectl delete with no agent
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl delete pod my-pod" },
        cwd: "/test",
        // agent is undefined
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should block (no agent = not k8s-owner)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Kubectl dangerous operation blocked")
    })

    test("should block context switch by undefined agent", () => {
      //#given - kubectl context switch with no agent
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "kubectl config use-context dev-cluster" },
        cwd: "/test",
        // agent is undefined
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should block
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("Kubectl context switch blocked")
    })
  })

  describe("edge cases", () => {
    test("should handle empty command", () => {
      //#given - empty command
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: { command: "" },
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow (no command)
      expect(result.blocked).toBe(false)
    })

    test("should handle missing command property", () => {
      //#given - no command property
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "bash",
        toolInput: {},
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow (no command)
      expect(result.blocked).toBe(false)
    })

    test("should handle missing tmux_command property (interactive_bash)", () => {
      //#given - no tmux_command property
      const context: PreToolUseContext = {
        sessionId: "test-session",
        toolName: "interactive_bash",
        toolInput: {},
        cwd: "/test",
        agent: "sisyphus",
      }
      const config = {} as OhMyOpenCodeConfig

      //#when
      const result = enforceKubectlWriteRestriction(context, config)

      //#then - should allow (no command)
      expect(result.blocked).toBe(false)
    })
  })
})
