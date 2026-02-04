import { describe, test, expect } from "bun:test"
import { classifyKubectlCommand } from "./kubectl-command-classifier"

describe("kubectl-command-classifier", () => {
  describe("isKubectl detection", () => {
    test("should detect 'kubectl' command", () => {
      // #given
      const command = "kubectl get pods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
    })

    test("should detect 'kubectl' with full path", () => {
      // #given
      const command = "/usr/local/bin/kubectl get pods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
    })

    test("should detect 'kubectl' with absolute path on Windows", () => {
      // #given
      const command = "C:\\Program Files\\kubectl\\kubectl.exe get pods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
    })

    test("should not detect non-kubectl commands", () => {
      // #given
      const command = "docker ps"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(false)
    })

    test("should not detect 'kubectl' in quoted strings", () => {
      // #given
      const command = 'echo "kubectl get pods"'

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(false)
    })

    test("should not detect 'kubectl' in comments", () => {
      // #given
      const command = "# kubectl get pods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(false)
    })

    test("should handle empty command", () => {
      // #given
      const command = ""

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(false)
    })

    test("should handle whitespace-only command", () => {
      // #given
      const command = "   "

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(false)
    })

    test("should detect 'kubectx' command", () => {
      // #given
      const command = "kubectx"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
    })

    test("should detect 'kubens' command", () => {
      // #given
      const command = "kubens"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
    })
  })

  describe("context switch operations detection", () => {
    describe("kubectl --context flag", () => {
      test("should detect 'kubectl --context' with get command", () => {
        // #given
        const command = "kubectl --context prd-mss-cluster get pods"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isKubectl).toBe(true)
        expect(result.isContextSwitch).toBe(true)
        expect(result.isDangerous).toBe(false)
        expect(result.matchedPattern).toBe("kubectl --context")
      })

      test("should detect 'kubectl --context' with any command", () => {
        // #given
        const command = "kubectl --context dev-mss-cluster describe pod my-pod"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isContextSwitch).toBe(true)
        expect(result.matchedPattern).toBe("kubectl --context")
      })

      test("should detect 'kubectl --context' at any position", () => {
        // #given
        const command = "kubectl get pods --context prd-mss-cluster"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isContextSwitch).toBe(true)
        expect(result.matchedPattern).toBe("kubectl --context")
      })
    })

    describe("kubectl config use-context", () => {
      test("should detect 'kubectl config use-context'", () => {
        // #given
        const command = "kubectl config use-context prd-mss-cluster"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isKubectl).toBe(true)
        expect(result.isContextSwitch).toBe(true)
        expect(result.isDangerous).toBe(false)
        expect(result.matchedPattern).toBe("kubectl config use-context")
      })

      test("should detect 'kubectl config use-context' with full cluster name", () => {
        // #given
        const command = "kubectl config use-context arn:aws:eks:us-west-2:123456789012:cluster/my-cluster"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isContextSwitch).toBe(true)
        expect(result.matchedPattern).toBe("kubectl config use-context")
      })
    })

    describe("kubectx commands", () => {
      test("should detect 'kubectx' with context name (context switch)", () => {
        // #given
        const command = "kubectx prd-mss-cluster"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isKubectl).toBe(true)
        expect(result.isContextSwitch).toBe(true)
        expect(result.isDangerous).toBe(false)
        expect(result.matchedPattern).toBe("kubectx (context switch)")
      })

      test("should not detect 'kubectx' without arguments (list contexts - read)", () => {
        // #given
        const command = "kubectx"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isKubectl).toBe(true)
        expect(result.isContextSwitch).toBe(false)
        expect(result.isDangerous).toBe(false)
      })

      test("should not detect 'kubectx -' (switch to previous - read)", () => {
        // #given
        const command = "kubectx -"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isKubectl).toBe(true)
        expect(result.isContextSwitch).toBe(false)
      })

      test("should detect 'kubectx' with full path", () => {
        // #given
        const command = "/usr/local/bin/kubectx prd-mss-cluster"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isContextSwitch).toBe(true)
      })

      test("should detect 'kubectx.exe' on Windows", () => {
        // #given
        const command = "kubectx.exe dev-cluster"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isContextSwitch).toBe(true)
      })
    })

    describe("kubens commands", () => {
      test("should detect 'kubens' with namespace name (namespace switch)", () => {
        // #given
        const command = "kubens prd-member"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isKubectl).toBe(true)
        expect(result.isContextSwitch).toBe(true)
        expect(result.isDangerous).toBe(false)
        expect(result.matchedPattern).toBe("kubens (namespace switch)")
      })

      test("should not detect 'kubens' without arguments (list namespaces - read)", () => {
        // #given
        const command = "kubens"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isKubectl).toBe(true)
        expect(result.isContextSwitch).toBe(false)
        expect(result.isDangerous).toBe(false)
      })

      test("should not detect 'kubens -' (switch to previous - read)", () => {
        // #given
        const command = "kubens -"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isKubectl).toBe(true)
        expect(result.isContextSwitch).toBe(false)
      })

      test("should detect 'kubens' with full path", () => {
        // #given
        const command = "/usr/local/bin/kubens dev-namespace"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isContextSwitch).toBe(true)
      })

      test("should detect 'kubens.exe' on Windows", () => {
        // #given
        const command = "kubens.exe default"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isContextSwitch).toBe(true)
      })
    })
  })

  describe("dangerous operations detection", () => {
    describe("scale operations", () => {
      test("should detect 'kubectl scale'", () => {
        // #given
        const command = "kubectl scale deployment/my-app --replicas=3"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isKubectl).toBe(true)
        expect(result.isDangerous).toBe(true)
        expect(result.isContextSwitch).toBe(false)
        expect(result.matchedPattern).toBe("kubectl scale")
      })

      test("should detect 'kubectl scale' for statefulset", () => {
        // #given
        const command = "kubectl scale statefulset/db --replicas=5"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl scale")
      })
    })

    describe("delete operations", () => {
      test("should detect 'kubectl delete pod'", () => {
        // #given
        const command = "kubectl delete pod my-pod"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl delete")
      })

      test("should detect 'kubectl delete deployment'", () => {
        // #given
        const command = "kubectl delete deployment my-app"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl delete")
      })

      test("should detect 'kubectl delete' with --all flag", () => {
        // #given
        const command = "kubectl delete pods --all"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
      })

      test("should detect 'kubectl delete' with -f flag", () => {
        // #given
        const command = "kubectl delete -f deployment.yaml"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
      })
    })

    describe("apply/create operations", () => {
      test("should detect 'kubectl apply'", () => {
        // #given
        const command = "kubectl apply -f deployment.yaml"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl apply")
      })

      test("should detect 'kubectl create'", () => {
        // #given
        const command = "kubectl create deployment my-app --image=nginx"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl create")
      })
    })

    describe("patch/edit operations", () => {
      test("should detect 'kubectl patch'", () => {
        // #given
        const command = "kubectl patch deployment my-app -p '{\"spec\":{\"replicas\":3}}'"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl patch")
      })

      test("should detect 'kubectl edit'", () => {
        // #given
        const command = "kubectl edit deployment/my-app"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl edit")
      })
    })

    describe("rollout operations", () => {
      test("should detect 'kubectl rollout restart'", () => {
        // #given
        const command = "kubectl rollout restart deployment/my-app"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl rollout restart")
      })

      test("should detect 'kubectl rollout undo'", () => {
        // #given
        const command = "kubectl rollout undo deployment/my-app"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl rollout undo")
      })

      test("should not detect 'kubectl rollout status' (read)", () => {
        // #given
        const command = "kubectl rollout status deployment/my-app"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })

      test("should not detect 'kubectl rollout history' (read)", () => {
        // #given
        const command = "kubectl rollout history deployment/my-app"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })

    describe("node operations", () => {
      test("should detect 'kubectl drain'", () => {
        // #given
        const command = "kubectl drain node-1 --ignore-daemonsets"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl drain")
      })

      test("should detect 'kubectl cordon'", () => {
        // #given
        const command = "kubectl cordon node-1"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl cordon")
      })

      test("should detect 'kubectl uncordon'", () => {
        // #given
        const command = "kubectl uncordon node-1"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl uncordon")
      })
    })

    describe("potentially dangerous operations", () => {
      test("should detect 'kubectl exec'", () => {
        // #given
        const command = "kubectl exec -it my-pod -- /bin/bash"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl exec")
      })

      test("should detect 'kubectl port-forward'", () => {
        // #given
        const command = "kubectl port-forward svc/my-service 8080:80"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl port-forward")
      })

      test("should detect 'kubectl proxy'", () => {
        // #given
        const command = "kubectl proxy --port=8001"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl proxy")
      })
    })

    describe("config write operations", () => {
      test("should detect 'kubectl config set'", () => {
        // #given
        const command = "kubectl config set current-context my-cluster"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl config set")
      })

      test("should detect 'kubectl config set-context'", () => {
        // #given
        const command = "kubectl config set-context my-context --namespace=default"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl config set-context")
      })

      test("should detect 'kubectl config set-cluster'", () => {
        // #given
        const command = "kubectl config set-cluster my-cluster --server=https://example.com"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl config set-cluster")
      })

      test("should detect 'kubectl config set-credentials'", () => {
        // #given
        const command = "kubectl config set-credentials my-user --token=abc123"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl config set-credentials")
      })
    })

    describe("label/annotation operations", () => {
      test("should detect 'kubectl label'", () => {
        // #given
        const command = "kubectl label pods my-pod env=production"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl label")
      })

      test("should detect 'kubectl annotate'", () => {
        // #given
        const command = "kubectl annotate pods my-pod description='My app'"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl annotate")
      })
    })

    describe("taint operations", () => {
      test("should detect 'kubectl taint'", () => {
        // #given
        const command = "kubectl taint nodes node1 key=value:NoSchedule"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl taint")
      })
    })

    describe("replace operations", () => {
      test("should detect 'kubectl replace'", () => {
        // #given
        const command = "kubectl replace -f deployment.yaml"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl replace")
      })
    })

    describe("run operations", () => {
      test("should detect 'kubectl run'", () => {
        // #given
        const command = "kubectl run nginx --image=nginx"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl run")
      })
    })

    describe("expose operations", () => {
      test("should detect 'kubectl expose'", () => {
        // #given
        const command = "kubectl expose deployment nginx --port=80 --type=LoadBalancer"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl expose")
      })
    })

    describe("set operations", () => {
      test("should detect 'kubectl set'", () => {
        // #given
        const command = "kubectl set image deployment/my-app nginx=nginx:1.20"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl set")
      })
    })

    describe("autoscale operations", () => {
      test("should detect 'kubectl autoscale'", () => {
        // #given
        const command = "kubectl autoscale deployment my-app --min=2 --max=10"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl autoscale")
      })
    })

    describe("certificate operations", () => {
      test("should detect 'kubectl certificate approve'", () => {
        // #given
        const command = "kubectl certificate approve csr-12345"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl certificate approve")
      })

      test("should detect 'kubectl certificate deny'", () => {
        // #given
        const command = "kubectl certificate deny csr-12345"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl certificate deny")
      })
    })

    describe("debug operations", () => {
      test("should detect 'kubectl debug'", () => {
        // #given
        const command = "kubectl debug my-pod -it --image=busybox"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(true)
        expect(result.matchedPattern).toBe("kubectl debug")
      })
    })
  })

  describe("read operations detection", () => {
    describe("get operations", () => {
      test("should detect 'kubectl get pods' (read)", () => {
        // #given
        const command = "kubectl get pods"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isKubectl).toBe(true)
        expect(result.isDangerous).toBe(false)
        expect(result.isContextSwitch).toBe(false)
      })

      test("should detect 'kubectl get deployments' (read)", () => {
        // #given
        const command = "kubectl get deployments -n production"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })

      test("should detect 'kubectl get all' (read)", () => {
        // #given
        const command = "kubectl get all"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })

    describe("describe operations", () => {
      test("should detect 'kubectl describe'", () => {
        // #given
        const command = "kubectl describe pod my-pod"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })

      test("should detect 'kubectl describe' with namespace", () => {
        // #given
        const command = "kubectl describe deployment my-app -n production"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })

    describe("logs operations", () => {
      test("should detect 'kubectl logs'", () => {
        // #given
        const command = "kubectl logs my-pod"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })

      test("should detect 'kubectl logs' with follow flag", () => {
        // #given
        const command = "kubectl logs -f my-pod"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })

    describe("top operations", () => {
      test("should detect 'kubectl top'", () => {
        // #given
        const command = "kubectl top nodes"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })

      test("should detect 'kubectl top pods'", () => {
        // #given
        const command = "kubectl top pods -n production"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })

    describe("explain operations", () => {
      test("should detect 'kubectl explain'", () => {
        // #given
        const command = "kubectl explain pods"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })

      test("should detect 'kubectl explain' with nested fields", () => {
        // #given
        const command = "kubectl explain pods.spec.containers"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })

    describe("config read operations", () => {
      test("should detect 'kubectl config current-context'", () => {
        // #given
        const command = "kubectl config current-context"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })

      test("should detect 'kubectl config get-contexts'", () => {
        // #given
        const command = "kubectl config get-contexts"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })

      test("should detect 'kubectl config view'", () => {
        // #given
        const command = "kubectl config view"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })

    describe("api-resources operations", () => {
      test("should detect 'kubectl api-resources'", () => {
        // #given
        const command = "kubectl api-resources"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })

    describe("version operations", () => {
      test("should detect 'kubectl version'", () => {
        // #given
        const command = "kubectl version"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })

      test("should detect 'kubectl version --client'", () => {
        // #given
        const command = "kubectl version --client"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })

    describe("cluster-info operations", () => {
      test("should detect 'kubectl cluster-info'", () => {
        // #given
        const command = "kubectl cluster-info"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })

    describe("auth operations", () => {
      test("should detect 'kubectl auth can-i'", () => {
        // #given
        const command = "kubectl auth can-i create pods"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })

      test("should detect 'kubectl auth whoami'", () => {
        // #given
        const command = "kubectl auth whoami"

        // #when
        const result = classifyKubectlCommand(command)

        // #then
        expect(result.isDangerous).toBe(false)
      })
    })
  })

  describe("edge cases", () => {
    test("should handle chained commands with &&", () => {
      // #given
      const command = "kubectl get pods && kubectl delete pod my-pod"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(false)
    })

    test("should handle chained commands with ;", () => {
      // #given
      const command = "kubectl get pods; kubectl logs my-pod"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(false)
    })

    test("should handle piped commands", () => {
      // #given
      const command = "kubectl get pods | grep Running"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(false)
    })

    test("should handle commands with quoted arguments", () => {
      // #given
      const command = 'kubectl patch deployment my-app -p \'{"spec":{"replicas":3}}\''

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isDangerous).toBe(true)
    })

    test("should handle commands with double-quoted arguments", () => {
      // #given
      const command = 'kubectl label pods my-pod "env=production"'

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isDangerous).toBe(true)
    })

    test("should handle commands with escaped quotes", () => {
      // #given
      const command = 'kubectl patch deployment my-app -p "{\\"spec\\":{\\"replicas\\":3}}"'

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isDangerous).toBe(true)
    })

    test("should handle commands with environment variables", () => {
      // #given
      const command = "KUBECONFIG=/tmp/config kubectl get pods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(false)
    })

    test("should handle commands with multiple environment variables", () => {
      // #given
      const command = "KUBECONFIG=/tmp/config KUBECTL_CONTEXT=dev kubectl delete pod my-pod"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(true)
    })

    test("should handle commands with redirects", () => {
      // #given
      const command = "kubectl get pods > pods.txt"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(false)
    })

    test("should handle commands with background execution", () => {
      // #given
      const command = "kubectl get pods &"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(false)
    })

    test("should handle case-insensitive kubectl command", () => {
      // #given
      const command = "KUBECTL get pods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
    })

    test("should handle kubectl with .exe extension", () => {
      // #given
      const command = "kubectl.exe delete pod my-pod"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(true)
    })

    test("should handle commands with tabs and multiple spaces", () => {
      // #given
      const command = "kubectl\t\tget\tpods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(false)
    })

    test("should not detect kubectl in middle of word", () => {
      // #given
      const command = "fakubectl get pods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(false)
    })

    test("should handle output redirection with append", () => {
      // #given
      const command = "kubectl get pods >> pods.txt"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(false)
    })

    test("should handle input redirection", () => {
      // #given
      const command = "kubectl apply -f - < deployment.yaml"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(true)
    })

    test("should handle commands with error redirection", () => {
      // #given
      const command = "kubectl get pods 2>&1"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.isKubectl).toBe(true)
      expect(result.isDangerous).toBe(false)
    })
  })

  describe("return type validation", () => {
    test("should return object with isKubectl, isDangerous, and isContextSwitch properties", () => {
      // #given
      const command = "kubectl get pods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(typeof result.isKubectl).toBe("boolean")
      expect(typeof result.isDangerous).toBe("boolean")
      expect(typeof result.isContextSwitch).toBe("boolean")
    })

    test("should include matchedPattern when dangerous pattern matches", () => {
      // #given
      const command = "kubectl delete pod my-pod"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.matchedPattern).toBeDefined()
      expect(typeof result.matchedPattern).toBe("string")
    })

    test("should include matchedPattern when context switch pattern matches", () => {
      // #given
      const command = "kubectl --context prd-mss-cluster get pods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.matchedPattern).toBeDefined()
      expect(typeof result.matchedPattern).toBe("string")
    })

    test("should not include matchedPattern for non-kubectl commands", () => {
      // #given
      const command = "docker ps"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.matchedPattern).toBeUndefined()
    })

    test("should not include matchedPattern for safe kubectl commands", () => {
      // #given
      const command = "kubectl get pods"

      // #when
      const result = classifyKubectlCommand(command)

      // #then
      expect(result.matchedPattern).toBeUndefined()
    })
  })
})
