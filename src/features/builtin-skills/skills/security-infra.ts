import type { BuiltinSkill } from "../types"

export const SECURITY_INFRA_SKILL_NAME = "security-infra"

const SECURITY_INFRA_SKILL_DESCRIPTION =
  "Infrastructure and container security guidelines: container scanning, Dockerfile hardening, Kubernetes security, IaC scanning, and cloud security fundamentals. Triggers: 'container security', 'Docker', 'Kubernetes', 'IaC', 'infrastructure', 'Checkov', 'tfsec', 'cloud security', 'Dockerfile'."

export const securityInfraSkill: BuiltinSkill = {
  name: SECURITY_INFRA_SKILL_NAME,
  description: SECURITY_INFRA_SKILL_DESCRIPTION,
  template: `# Security — Infrastructure & Containers

## CONTAINER SCANNING

### Trivy Image Scan
- \`trivy image --format json <image:tag>\`
- \`trivy image --severity CRITICAL,HIGH --format json <image:tag>\`

### Grype
- \`grype <image:tag> -o json\`

*Note: Scan both base images and final images.*

## DOCKERFILE HARDENING CHECKLIST

- Use specific image tags (never \`latest\`)
- Multi-stage builds to minimize final image size and attack surface
- Run as non-root user (USER directive)
- Don't copy secrets into images (use build args or runtime mounting)
- Use COPY instead of ADD (ADD can auto-extract and fetch URLs)
- Set HEALTHCHECK for container monitoring
- Minimize installed packages, remove package manager caches
- Use .dockerignore to exclude sensitive files

## KUBERNETES SECURITY

- Pod Security Standards (Restricted, Baseline, Privileged)
- Network Policies for pod-to-pod communication restrictions
- RBAC for API access control
- Secret management (external secrets operator, sealed secrets)
- Resource limits to prevent DoS
- Read-only root filesystem where possible
- Disable service account token automounting when not needed

## INFRASTRUCTURE AS CODE SCANNING

### Tools
- Checkov: \`checkov -d . --output json\`, \`checkov -f main.tf --output json\`
- tfsec: \`tfsec . --format json\`
- KICS: \`kics scan -p . -o json\`

### Common IaC Misconfigurations
- public S3 buckets
- open security groups (0.0.0.0/0)
- unencrypted storage
- missing logging
- overly permissive IAM policies

## CLOUD SECURITY FUNDAMENTALS

- Principle of least privilege for IAM roles/policies
- Enable CloudTrail/audit logging
- Encrypt data at rest and in transit
- VPC design: private subnets for workloads, public subnets only for load balancers
- Security groups: deny by default, allow minimum required
`,
}
