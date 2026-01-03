# Deploy Skill

Enterprise deployment skill for cloud infrastructure and application deployments.

## Commands

- `/deploy release <service>` - Deploy service to environment
- `/deploy rollback <service>` - Rollback to previous version
- `/deploy status [service]` - Check deployment status
- `/deploy diff <source> <target>` - Compare environments/versions

## Release Deployments

`/deploy release api-gateway --env production --version v2.1.0` performs:
1. Pre-deployment health checks
2. Infrastructure validation (Terraform plan)
3. Container/function deployment (ECS/Lambda)
4. Rolling update with health monitoring
5. Automatic rollback on failure

### Deployment Strategies

- **rolling** (default): Gradual replacement of instances
- **blue-green**: Full parallel deployment with instant cutover
- **canary**: Percentage-based traffic shifting

### Examples

```
/deploy release user-api --env staging
/deploy release payment-service --env production --strategy canary --canary-percentage 10
/deploy release auth-service --env production --dry-run
```

## Rollback

`/deploy rollback api-gateway --env production` initiates:
1. Identifies previous stable version
2. Health check on previous version artifacts
3. Traffic shift to stable version
4. Cleanup of failed deployment

### Examples

```
/deploy rollback user-api --env production
/deploy rollback payment-service --env staging --target-version v1.8.2
/deploy rollback auth-service --env production --reason "Memory leak in v2.0"
```

## Status Monitoring

`/deploy status` provides:
- Service health across environments
- Active deployments in progress
- Recent deployment history
- Infrastructure state

### Examples

```
/deploy status
/deploy status user-api
/deploy status --env production
/deploy status --include-history --limit 10
```

## Environment Diff

`/deploy diff staging production` compares:
- Container/function versions
- Environment variables (non-secret)
- Resource configurations (CPU, memory, scaling)
- Infrastructure differences

### Examples

```
/deploy diff staging production --service user-api
/deploy diff v2.0.0 v2.1.0 --service payment-service
/deploy diff staging production --include config,resources
```

## Integrations

### AWS

Set environment variables:
- AWS_ACCESS_KEY_ID: Your AWS access key
- AWS_SECRET_ACCESS_KEY: Your AWS secret key
- AWS_REGION: Target AWS region (default: us-east-1)
- AWS_PROFILE: Named profile (optional, alternative to keys)

Supported services:
- **ECS**: Container deployments with task definition updates
- **Lambda**: Function deployments with version/alias management
- **CloudWatch**: Deployment metrics and alarms

### Terraform

Set environment variables:
- TF_VAR_*: Terraform variables
- TF_WORKSPACE: Terraform workspace (optional)
- TERRAFORM_CLOUD_TOKEN: Terraform Cloud token (if using remote backend)

Supported operations:
- **plan**: Preview infrastructure changes
- **apply**: Apply infrastructure changes
- **state**: Query current infrastructure state

## Safety Features

- Dry-run mode for all deployments
- Automatic health checks before and after
- Immediate rollback on failed health checks
- Deployment locks to prevent concurrent deploys
- Audit trail for all operations
