import type { BuiltinSkill } from "./types"

const playwrightSkill: BuiltinSkill = {
  name: "playwright",
  description: "Browser automation with Playwright MCP. Use for web scraping, testing, screenshots, and browser interactions.",
  template: `# Playwright Browser Automation

This skill provides browser automation capabilities via the Playwright MCP server.`,
  mcpConfig: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
    },
  },
}

const knowledgeSkill: BuiltinSkill = {
  name: "knowledge",
  description: "Query and manage organizational knowledge (ADRs, policies, patterns, specs). Provides context-aware knowledge injection and constraint violation detection.",
  template: `# Knowledge Management Skill

Manage organizational knowledge with hierarchical layers (company → org → project).

## Commands

- \`/knowledge query <search>\` - Search knowledge by keywords
- \`/knowledge list [--layer <layer>] [--type <type>]\` - List knowledge items
- \`/knowledge show <id>\` - Show full knowledge content
- \`/knowledge propose <type> <title>\` - Propose new knowledge item

## Knowledge Types

- **adr**: Architectural Decision Records
- **policy**: Organizational policies with enforcement rules
- **pattern**: Reusable code/design patterns
- **spec**: Technical specifications

## Knowledge Layers

- **company**: Organization-wide knowledge (highest priority)
- **org**: Business unit / team knowledge
- **project**: Project-specific knowledge (can override higher layers)

## Severity Levels

- **info**: Informational, no action required
- **warn**: Warning, agent should acknowledge
- **block**: Blocking, agent must stop and report violation

## Examples

\`\`\`
/knowledge query authentication
/knowledge list --type policy --layer org
/knowledge show abc123
/knowledge propose adr "Use TypeScript for all new services"
\`\`\`
`,
  argumentHint: "query|list|show|propose [args]",
}

const debugSkill: BuiltinSkill = {
  name: "debug",
  description: "Enterprise debugging skill for distributed systems and interactive code debugging. Root cause analysis, log aggregation, metrics, profiling via Datadog/Sentry, PLUS interactive debugging with breakpoints, stepping, and variable inspection via DAP/LLDB/GDB.",
  template: `# Debug Skill

Enterprise debugging for distributed systems and interactive code debugging.

## Part 1: Observability Debugging

- \`/debug trace <error>\` - Analyze error/stack trace for root cause
- \`/debug logs <query>\` - Search and aggregate logs
- \`/debug metrics <metric>\` - Query and visualize metrics
- \`/debug profile <service>\` - Capture performance profiles

## Part 2: Interactive Debugging

- \`/debug launch <program>\` - Start debugging a program
- \`/debug attach <target>\` - Attach to running process
- \`/debug breakpoint set|remove|list|clear\` - Manage breakpoints
- \`/debug step into|over|out\` - Control execution stepping
- \`/debug continue\` - Continue execution
- \`/debug stacktrace\` - View call stack
- \`/debug variables [scope]\` - Inspect variables
- \`/debug evaluate <expression>\` - Evaluate expression in debug context
- \`/debug session list|switch|terminate\` - Manage debug sessions

## Trace Analysis

\`/debug trace "Connection refused"\` analyzes:
1. Error classification (network, database, memory, etc.)
2. Trace correlation across services
3. Timeline reconstruction
4. Pattern matching against known failures
5. Root cause hypothesis with evidence

## Interactive Debugging Examples

\`\`\`
/debug launch src/main.py --lang python
/debug breakpoint set src/auth.py:42 --condition "user_id == 123"
/debug step into
/debug variables local
/debug evaluate "len(users)"
/debug continue
\`\`\`

## Integrations

### Observability Platforms

#### Datadog
Set environment variables:
- DD_API_KEY: Your Datadog API key
- DD_APP_KEY: Your Datadog application key  
- DD_SITE: Your Datadog site (default: datadoghq.com)

#### Sentry
Set environment variables:
- SENTRY_AUTH_TOKEN: Your Sentry auth token
- SENTRY_ORG: Your Sentry organization slug
- SENTRY_PROJECT: Your Sentry project slug (optional)

### Interactive Debuggers

#### MCP-Debugger (Python, JavaScript, Rust)
Multi-language DAP-based debugger. No configuration needed.

#### LLDB MCP (C/C++/Rust/Swift)
Requires LLDB installed on system.

#### DevTools Debugger (JavaScript/TypeScript)
Chrome DevTools Protocol integration for browser/Node.js debugging.

#### JetBrains MCP (All Languages)
Built-in for JetBrains 2025.2+, or use proxy for older versions.
Requires JetBrains IDE running with MCP Server enabled.
`,
  argumentHint: "trace|logs|metrics|profile|launch|attach|breakpoint|step|continue|stacktrace|variables|evaluate|session [args]",
  mcpConfig: {
    datadog: {
      command: "npx",
      args: ["-y", "@winor30/mcp-server-datadog"],
      env: {
        DATADOG_API_KEY: "${DD_API_KEY}",
        DATADOG_APP_KEY: "${DD_APP_KEY}",
        DATADOG_SITE: "${DD_SITE:-datadoghq.com}",
      },
    },
    sentry: {
      command: "uvx",
      args: [
        "mcp-sentry",
        "--auth-token", "${SENTRY_AUTH_TOKEN}",
        "--organization-slug", "${SENTRY_ORG}",
        "--project-slug", "${SENTRY_PROJECT:-}",
      ],
    },
    "mcp-debugger": {
      command: "npx",
      args: ["-y", "@debugmcp/mcp-debugger"],
    },
    "devtools-debugger": {
      command: "npx",
      args: ["-y", "devtools-debugger-mcp"],
    },
    jetbrains: {
      command: "npx",
      args: ["-y", "@jetbrains/mcp-proxy"],
      env: {
        IDE_PORT: "${JETBRAINS_IDE_PORT:-63342}",
      },
    },
  },
}

const deploySkill: BuiltinSkill = {
  name: "deploy",
  description: "Enterprise deployment skill for cloud infrastructure. Release management, rollbacks, status monitoring, and environment diffing via AWS/Terraform integration.",
  template: `# Deploy Skill

Enterprise deployment for cloud infrastructure with AWS and Terraform integration.

## Commands

- \`/deploy release <service>\` - Deploy service to environment
- \`/deploy rollback <service>\` - Rollback to previous version
- \`/deploy status [service]\` - Check deployment status
- \`/deploy diff <source> <target>\` - Compare environments/versions

## Release Deployments

\`/deploy release api-gateway --env production --version v2.1.0\` performs:
1. Pre-deployment health checks
2. Infrastructure validation (Terraform plan)
3. Container/function deployment (ECS/Lambda)
4. Rolling update with health monitoring
5. Automatic rollback on failure

### Deployment Strategies

- **rolling** (default): Gradual replacement of instances
- **blue-green**: Full parallel deployment with instant cutover
- **canary**: Percentage-based traffic shifting

## Examples

\`\`\`
/deploy release user-api --env staging
/deploy release payment-service --env production --strategy canary --canary-percentage 10
/deploy rollback user-api --env production
/deploy status --env production
/deploy diff staging production --service user-api
\`\`\`

## Integrations

### AWS

Set environment variables:
- AWS_ACCESS_KEY_ID: Your AWS access key
- AWS_SECRET_ACCESS_KEY: Your AWS secret key
- AWS_REGION: Target AWS region (default: us-east-1)

Supported services: ECS, Lambda, CloudWatch

### Terraform

Set environment variables:
- TFE_TOKEN: Terraform Cloud/Enterprise token
- TFE_ADDRESS: Terraform Enterprise address (optional)

Supported operations: plan, apply, state queries
`,
  argumentHint: "release|rollback|status|diff [args]",
  mcpConfig: {
    aws: {
      command: "uvx",
      args: [
        "--from",
        "git+https://github.com/rishikavikondala/mcp-server-aws",
        "mcp-server-aws",
      ],
      env: {
        AWS_ACCESS_KEY_ID: "${AWS_ACCESS_KEY_ID}",
        AWS_SECRET_ACCESS_KEY: "${AWS_SECRET_ACCESS_KEY}",
        AWS_REGION: "${AWS_REGION:-us-east-1}",
      },
    },
    terraform: {
      command: "docker",
      args: [
        "run",
        "-i",
        "--rm",
        "-e", "TFE_TOKEN=${TFE_TOKEN}",
        "-e", "TFE_ADDRESS=${TFE_ADDRESS:-}",
        "-e", "ENABLE_TF_OPERATIONS=true",
        "hashicorp/terraform-mcp-server:0.3.3",
      ],
    },
  },
}

const projectSkill: BuiltinSkill = {
  name: "project",
  description: "Enterprise project management for Jira, Confluence, and Linear. Issue tracking, sprint management, documentation, and cross-platform search.",
  template: `# Project Management Skill

Enterprise project management with Atlassian and Linear integration.

## Commands

- \`/project issue <action>\` - Manage Jira/Linear issues
- \`/project sprint <action>\` - Manage sprints/cycles
- \`/project board <action>\` - View boards and backlogs
- \`/project doc <action>\` - Manage Confluence pages
- \`/project search <query>\` - Search across issues and docs

## Issue Management

\`\`\`
/project issue create --project PROJ --type story --summary "Add user auth"
/project issue update PROJ-123 --status "In Progress" --assignee @john
/project issue transition PROJ-123 --status "Done"
/project issue comment PROJ-123 --message "Completed implementation"
\`\`\`

## Sprint Management

\`\`\`
/project sprint list --board 1
/project sprint create --board 1 --name "Sprint 42" --goal "Complete auth"
/project sprint add-issues --sprint 100 --issues PROJ-1,PROJ-2
\`\`\`

## Documentation (Confluence)

\`\`\`
/project doc search --query "architecture decision"
/project doc create --space ENG --title "ADR-001: Use TypeScript"
/project doc update --page 12345 --content "Updated content..."
\`\`\`

## Integrations

### Atlassian (Jira + Confluence)

Set environment variables:
- ATLASSIAN_URL: Your Atlassian instance (e.g., https://company.atlassian.net)
- ATLASSIAN_EMAIL: Your Atlassian account email
- ATLASSIAN_API_TOKEN: Your Atlassian API token

Generate token at: https://id.atlassian.com/manage-profile/security/api-tokens

### Linear

Set environment variables:
- LINEAR_API_KEY: Your Linear API key

Generate key at: https://linear.app/settings/api
`,
  argumentHint: "issue|sprint|board|doc|search [args]",
  mcpConfig: {
    jira: {
      command: "npx",
      args: ["-y", "@aashari/mcp-server-atlassian-jira"],
      env: {
        JIRA_HOST: "${ATLASSIAN_URL}",
        JIRA_EMAIL: "${ATLASSIAN_EMAIL}",
        JIRA_API_TOKEN: "${ATLASSIAN_API_TOKEN}",
      },
    },
    confluence: {
      command: "npx",
      args: ["-y", "@aashari/mcp-server-atlassian-confluence"],
      env: {
        CONFLUENCE_HOST: "${ATLASSIAN_URL}",
        CONFLUENCE_EMAIL: "${ATLASSIAN_EMAIL}",
        CONFLUENCE_API_TOKEN: "${ATLASSIAN_API_TOKEN}",
      },
    },
    linear: {
      command: "npx",
      args: ["-y", "linear-mcp"],
      env: {
        LINEAR_API_KEY: "${LINEAR_API_KEY}",
      },
    },
  },
}

const testSkill: BuiltinSkill = {
  name: "test",
  description: "Enterprise testing skill for test execution, generation, coverage analysis, and pairwise test matrix creation via Playwright integration.",
  template: `# Test Skill

Enterprise testing for test execution, generation, coverage, and matrix creation.

## Commands

- \`/test run [pattern]\` - Run tests with optional pattern filter
- \`/test generate <file>\` - Generate tests for a source file
- \`/test coverage [directory]\` - Analyze code coverage
- \`/test matrix <parameters>\` - Generate pairwise test combinations (PICT)

## Test Execution

\`\`\`
/test run
/test run --file src/auth/login.test.ts
/test run --coverage
/test run --watch
/test run --grep "authentication"
\`\`\`

## Test Generation

\`\`\`
/test generate src/utils/parser.ts --type unit
/test generate src/api/users.ts --type integration --mocks
/test generate src/pages/login.tsx --type e2e --framework playwright
\`\`\`

## Coverage Analysis

\`\`\`
/test coverage
/test coverage --threshold lines:80,branches:70
/test coverage --reporter html,lcov
\`\`\`

## Test Matrix (PICT)

Generate efficient pairwise test combinations:

\`\`\`
/test matrix browser:chrome,firefox,safari os:windows,mac,linux
/test matrix paymentMethod:card,paypal currency:usd,eur --coverage 3
\`\`\`

## Integrations

### Playwright (E2E)

Playwright MCP provides browser automation for E2E testing:
- Multi-browser support (Chromium, Firefox, WebKit)
- Screenshots and video recording
- Network interception
- Mobile device emulation
`,
  argumentHint: "run|generate|coverage|matrix [args]",
  mcpConfig: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
    },
  },
}

const reviewSkill: BuiltinSkill = {
  name: "review",
  description: "Enterprise code review for GitHub PRs, files, diffs, and security analysis with the 10-question evaluation framework.",
  template: `# Code Review Skill

Enterprise code review for GitHub PRs, files, and security analysis.

## Commands

- \`/review pr <number>\` - Review a GitHub pull request
- \`/review file <path>\` - Review a specific file
- \`/review diff <base> [head]\` - Review changes between commits/branches
- \`/review security [paths]\` - Security-focused review

## PR Review

\`/review pr 123 --focus security\` performs:
1. PR metadata analysis (title, description, labels)
2. Change scope assessment (files changed, lines modified)
3. Code quality evaluation (10-question framework)
4. Security vulnerability scan
5. Performance impact analysis
6. Actionable suggestions with GitHub suggestion format

### Review Focus Areas

- **architecture**: Design patterns, abstractions, separation of concerns
- **performance**: Complexity, algorithms, resource usage
- **security**: Input validation, auth, injection, data exposure
- **all** (default): Comprehensive review covering all areas

## File Review

\`\`\`
/review file src/auth/login.ts --focus security
/review file src/api/users.ts --lines 10-50
\`\`\`

## Diff Review

\`\`\`
/review diff main feature/auth
/review diff HEAD~5 --paths src/api/
\`\`\`

## Security Review

\`\`\`
/review security
/review security src/auth/ --severity high
\`\`\`

Checks for:
- SQL/NoSQL injection
- XSS vulnerabilities
- Authentication bypasses
- Sensitive data exposure
- Insecure dependencies
- Hardcoded credentials

## Integrations

### GitHub

Set environment variables:
- GITHUB_TOKEN: Your GitHub personal access token
- GITHUB_OWNER: Repository owner (optional, auto-detected)
- GITHUB_REPO: Repository name (optional, auto-detected)

Token requires scopes: \`repo\`, \`read:org\` (for org repos)

## Review Framework (10 Questions)

Each review answers:
1. Does the code do what it's supposed to do?
2. Is the code understandable and maintainable?
3. Are there any obvious bugs or edge cases?
4. Is error handling comprehensive?
5. Are there security vulnerabilities?
6. Are there performance concerns?
7. Does it follow project conventions?
8. Is the test coverage adequate?
9. Is the documentation sufficient?
10. Are there any unnecessary changes?
`,
  argumentHint: "pr|file|diff|security [args]",
  mcpConfig: {
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}",
      },
    },
  },
}

const incidentSkill: BuiltinSkill = {
  name: "incident",
  description: "Enterprise incident response for on-call workflows, incident coordination, status updates, and blameless postmortem generation.",
  template: `# Incident Management Skill

Enterprise incident response for on-call workflows, incident coordination, and postmortems.

## Commands

- \`/incident start <title>\` - Declare a new incident
- \`/incident update <id>\` - Update incident status
- \`/incident resolve <id>\` - Resolve an incident
- \`/incident postmortem <id>\` - Generate postmortem document
- \`/incident oncall [schedule]\` - Show who's on-call

## Incident Lifecycle

### 1. Start an Incident

\`\`\`
/incident start "API latency spike" --severity SEV2 --service api-gateway
/incident start "Database connection failures" --severity SEV1 --assignee @oncall
\`\`\`

Creates incident in PagerDuty, notifies on-call, and establishes communication channels.

### 2. Update Status

\`\`\`
/incident update INC-123 --status investigating --message "Identified high CPU on db-primary"
/incident update INC-123 --status identified --message "Root cause: connection pool exhaustion"
/incident update INC-123 --status monitoring --message "Fix deployed, monitoring metrics"
\`\`\`

Status progression: \`investigating\` → \`identified\` → \`monitoring\` → \`resolved\`

### 3. Resolve

\`\`\`
/incident resolve INC-123 --resolution "Increased connection pool size" --root-cause "Traffic spike exceeded pool capacity"
\`\`\`

### 4. Generate Postmortem

\`\`\`
/incident postmortem INC-123 --template blameless
\`\`\`

Templates:
- **basic**: Summary, timeline, resolution
- **detailed**: Full analysis with metrics, logs, action items
- **blameless**: Focus on system improvements, no individual blame

## Severity Levels

| Level | Response Time | Description |
|-------|---------------|-------------|
| SEV1 | Immediate | Complete outage, data loss risk |
| SEV2 | 15 minutes | Major feature unavailable |
| SEV3 | 1 hour | Degraded service, workaround exists |
| SEV4 | 4 hours | Minor issue, low impact |

## On-Call Management

\`\`\`
/incident oncall                    # Show current on-call
/incident oncall --schedule primary # Show specific schedule
/incident oncall --time "2026-01-10 09:00" # Who's on-call at time
\`\`\`

## Integrations

### PagerDuty

Set environment variables:
- PAGERDUTY_API_KEY: Your PagerDuty API key
- PAGERDUTY_SERVICE_ID: Default service ID (optional)
- PAGERDUTY_ESCALATION_POLICY_ID: Default escalation policy (optional)

Get API key: https://support.pagerduty.com/docs/api-access-keys

### Slack (for notifications)

Set environment variables:
- SLACK_BOT_TOKEN: Slack bot token (xoxb-...)
- SLACK_INCIDENT_CHANNEL: Default incident channel ID

## Postmortem Framework

Generated postmortems follow Google SRE blameless postmortem format:

1. **Summary**: What happened, impact, duration
2. **Timeline**: Chronological events with timestamps
3. **Root Cause**: Technical analysis
4. **Resolution**: How it was fixed
5. **Impact**: Users affected, data impact
6. **Lessons Learned**: What worked, what didn't
7. **Action Items**: Preventive measures with owners
`,
  argumentHint: "start|update|resolve|postmortem|oncall [args]",
  mcpConfig: {
    pagerduty: {
      command: "uvx",
      args: ["pagerduty-mcp", "--enable-write-tools"],
      env: {
        PAGERDUTY_USER_API_KEY: "${PAGERDUTY_API_KEY}",
      },
    },
    slack: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: {
        SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}",
        SLACK_TEAM_ID: "${SLACK_TEAM_ID:-}",
      },
    },
  },
}

const codeIndexSkill: BuiltinSkill = {
  name: "code-index",
  description: "Semantic code search and AST-based code intelligence. Index your codebase for natural language queries, find similar code patterns, explore symbol relationships, and understand code behavior.",
  template: `# Code Index Skill

Semantic code search and AST-based code intelligence.

## Commands

- \`/code-index search <query>\` - Search codebase using natural language or code patterns
- \`/code-index similar <target>\` - Find code similar to a function, class, or file
- \`/code-index index [paths]\` - Index or re-index the codebase
- \`/code-index status\` - Show indexing status and statistics
- \`/code-index symbols <query>\` - Search for symbols by name
- \`/code-index references <symbol>\` - Find all references to a symbol
- \`/code-index dependencies <target>\` - Analyze dependencies of a file or module
- \`/code-index explain <target>\` - Get AI-powered explanation of code behavior

## Semantic Search

\`\`\`
/code-index search "authentication middleware"
/code-index search "error handling in API routes" --lang typescript
/code-index search "functions that parse JSON" --path src/utils/
\`\`\`

## Find Similar Code

\`\`\`
/code-index similar src/auth/login.ts:42
/code-index similar UserService.authenticate
\`\`\`

## Symbol Exploration

\`\`\`
/code-index symbols "User*"
/code-index symbols "parse" --kind function
/code-index references UserService
/code-index dependencies src/api/users.ts --depth 2
\`\`\`

## Code Explanation

\`\`\`
/code-index explain src/auth/oauth.ts:100
/code-index explain handleWebhook
\`\`\`

## Integrations

### Qdrant (Vector Database)

High-performance vector storage for code embeddings.

Set environment variables:
- QDRANT_URL: Qdrant server URL (default: http://localhost:6333)
- QDRANT_API_KEY: API key for Qdrant Cloud (optional)
- QDRANT_COLLECTION: Collection name (default: code-index)

Free tier: 1GB cluster free forever on Qdrant Cloud

### Chroma (Vector Database)

Local-first vector database for development.

Set environment variables:
- CHROMA_URL: Chroma server URL (optional, uses local by default)
- CHROMA_COLLECTION: Collection name (default: code-index)

## Language Support

TypeScript, JavaScript, Python, Rust, Go, Java, Kotlin, C#, C/C++, Ruby, PHP, Swift, Scala
`,
  argumentHint: "search|similar|index|status|symbols|references|dependencies|explain [args]",
  mcpConfig: {
    qdrant: {
      command: "npx",
      args: ["-y", "@qdrant/mcp-server-qdrant"],
      env: {
        QDRANT_URL: "${QDRANT_URL:-http://localhost:6333}",
        QDRANT_API_KEY: "${QDRANT_API_KEY:-}",
        QDRANT_COLLECTION_NAME: "${QDRANT_COLLECTION:-code-index}",
      },
    },
    chroma: {
      command: "uvx",
      args: ["chroma-mcp"],
      env: {
        CHROMA_CLIENT_TYPE: "${CHROMA_CLIENT_TYPE:-ephemeral}",
        CHROMA_HOST: "${CHROMA_URL:-}",
        CHROMA_COLLECTION: "${CHROMA_COLLECTION:-code-index}",
      },
    },
  },
}

const securitySkill: BuiltinSkill = {
  name: "security",
  description: "Enterprise security scanning for SAST code analysis, dependency vulnerability auditing, secrets detection, and compliance checking.",
  template: `# Security Skill

Enterprise security scanning for code analysis, dependency auditing, and compliance checking.

## Commands

- \`/security scan [paths]\` - Run SAST scan on codebase
- \`/security audit [target]\` - Comprehensive security audit
- \`/security secrets [paths]\` - Detect hardcoded secrets
- \`/security deps [lockfile]\` - Scan dependencies for vulnerabilities
- \`/security compliance <framework>\` - Check compliance requirements

## SAST Scanning

\`\`\`
/security scan
/security scan src/ --severity high
/security scan --rules owasp-top-10 --exclude tests/
\`\`\`

Scans for:
- SQL/NoSQL injection
- Cross-site scripting (XSS)
- Path traversal
- Command injection
- Insecure deserialization
- Authentication bypasses
- Cryptographic weaknesses

## Security Audit

\`\`\`
/security audit
/security audit --target code --format sarif
/security audit --target all
\`\`\`

Targets:
- **code**: Static analysis (Semgrep)
- **deps**: Dependency vulnerabilities (Snyk)
- **secrets**: Hardcoded credentials
- **all**: Complete security audit

## Secrets Detection

\`\`\`
/security secrets
/security secrets src/ --verify
\`\`\`

Detects:
- API keys
- AWS credentials
- Private keys
- Database connection strings
- OAuth tokens
- Webhook URLs

## Dependency Scanning

\`\`\`
/security deps
/security deps --lockfile package-lock.json --severity critical
/security deps --dev  # Include dev dependencies
\`\`\`

Checks:
- Known CVEs
- Outdated packages
- License compliance
- Transitive dependencies

## Compliance Checking

\`\`\`
/security compliance soc2
/security compliance pci --scope payments/
/security compliance gdpr
\`\`\`

Frameworks:
- **SOC2**: Service Organization Control
- **PCI**: Payment Card Industry DSS
- **HIPAA**: Health Insurance Portability
- **GDPR**: General Data Protection Regulation

## Severity Levels

| Level | Examples |
|-------|----------|
| critical | RCE, SQLi, hardcoded secrets |
| high | XSS, auth bypass, SSRF |
| medium | CSRF, info disclosure |
| low | Best practice violations |

## Integrations

### Semgrep

Set environment variables:
- SEMGREP_APP_TOKEN: Your Semgrep App token (optional, for cloud features)
- SEMGREP_DEPLOYMENT_ID: Semgrep deployment ID (optional)

Semgrep runs locally without authentication for basic scanning.

### Snyk

Set environment variables:
- SNYK_TOKEN: Your Snyk API token
- SNYK_ORG: Snyk organization ID (optional)

Get token: https://app.snyk.io/account

## Output Formats

- **text**: Human-readable console output
- **json**: Machine-readable JSON
- **sarif**: SARIF format for IDE integration

## Best Practices

1. Run \`/security scan\` before every PR
2. Run \`/security deps\` weekly or in CI
3. Run \`/security secrets\` before commits
4. Run \`/security compliance\` quarterly
`,
  argumentHint: "scan|audit|secrets|deps|compliance [args]",
  mcpConfig: {
    semgrep: {
      command: "npx",
      args: ["-y", "mcp-server-semgrep"],
      env: {
        SEMGREP_APP_TOKEN: "${SEMGREP_APP_TOKEN:-}",
      },
    },
    gitguardian: {
      command: "uvx",
      args: ["gitguardian-mcp-developer"],
      env: {
        GG_PERSONAL_ACCESS_TOKEN: "${GITGUARDIAN_TOKEN:-}",
      },
    },
  },
}

const perfSkill: BuiltinSkill = {
  name: "perf",
  description: "Performance profiling, benchmarking, and optimization analysis for identifying bottlenecks and improving application performance.",
  template: `# Performance Analysis Skill

Performance profiling, benchmarking, and optimization for applications.

## Commands

- \`/perf profile <target>\` - Capture CPU or memory profile
- \`/perf trace <target>\` - Trace execution flow and async operations
- \`/perf benchmark <target>\` - Run benchmarks with statistical analysis
- \`/perf analyze [profile]\` - Analyze profile data and identify bottlenecks
- \`/perf compare <baseline> <current>\` - Compare profiles/benchmarks
- \`/perf flamegraph <profile>\` - Generate interactive flamegraph
- \`/perf memory <target>\` - Analyze memory usage and detect leaks
- \`/perf cpu <target>\` - Analyze CPU usage patterns

## Profiling

\`\`\`
/perf profile ./src/server.ts --type cpu --duration 60
/perf profile http://localhost:3000/api/users --type memory
/perf analyze --threshold 5
\`\`\`

## Benchmarking

\`\`\`
/perf benchmark src/utils/parser.bench.ts
/perf benchmark parseJSON --iterations 10000 --name "v2"
/perf compare "v1" "v2"
\`\`\`

## Memory Analysis

\`\`\`
/perf memory ./src/server.ts --leaks --interval 60
\`\`\`

## Integrations

- Node.js Inspector (built-in)
- py-spy for Python
- pprof for Go
- perf for Linux

## Language Support

TypeScript, JavaScript, Python, Rust, Go, Java, C/C++
`,
  argumentHint: "profile|trace|benchmark|analyze|compare|flamegraph|memory|cpu [args]",
}

const apiSkill: BuiltinSkill = {
  name: "api",
  description: "API design, documentation, validation, and code generation for REST, GraphQL, and gRPC APIs.",
  template: `# API Design Skill

API design, documentation, validation, and code generation.

## Commands

- \`/api design <description>\` - Design API from natural language description
- \`/api document <spec>\` - Generate documentation from spec
- \`/api validate <spec>\` - Validate against best practices
- \`/api generate <spec>\` - Generate code from spec
- \`/api test <spec>\` - Test API against its specification
- \`/api mock <spec>\` - Start mock server from spec
- \`/api diff <old> <new>\` - Compare specs for breaking changes
- \`/api lint <spec>\` - Lint for style and consistency

## API Design

\`\`\`
/api design "User management API with CRUD and authentication"
/api design "Real-time chat service" --style event-driven
\`\`\`

## Documentation & Validation

\`\`\`
/api document ./openapi.yaml --format markdown --examples
/api validate ./openapi.yaml
/api lint ./openapi.yaml --fix
\`\`\`

## Code Generation

\`\`\`
/api generate ./openapi.yaml --target client --lang typescript
/api generate ./openapi.yaml --target server --lang python --framework fastapi
\`\`\`

## Testing

\`\`\`
/api mock ./openapi.yaml --port 4010
/api test ./openapi.yaml --url http://localhost:3000 --coverage
/api diff ./v1/openapi.yaml ./v2/openapi.yaml
\`\`\`

## Supported Formats

OpenAPI 3.x, OpenAPI 2.0, AsyncAPI, GraphQL, gRPC/Protobuf

## Integrations

### Postman MCP

Set environment variables:
- POSTMAN_API_KEY: Your Postman API key
`,
  argumentHint: "design|document|validate|generate|test|mock|diff|lint [args]",
  mcpConfig: {
    postman: {
      command: "npx",
      args: ["-y", "@anthropic/postman-api-mcp"],
      env: {
        POSTMAN_API_KEY: "${POSTMAN_API_KEY:-}",
      },
    },
  },
}

const dbSkill: BuiltinSkill = {
  name: "db",
  description: "Database management, query optimization, schema operations, and data migration for SQL and NoSQL databases.",
  template: `# Database Operations Skill

Database management, query optimization, and schema operations.

## Commands

- \`/db query <sql>\` - Execute database query
- \`/db schema [table]\` - View or manage schema
- \`/db migrate <action>\` - Manage migrations
- \`/db analyze [table]\` - Analyze performance
- \`/db optimize <target>\` - Optimize queries/tables
- \`/db explain <query>\` - Explain query execution plan
- \`/db backup <target>\` - Create database backup
- \`/db seed <source>\` - Seed with test data

## Query Operations

\`\`\`
/db query "SELECT * FROM users WHERE active = true"
/db explain "SELECT * FROM orders JOIN users ON orders.user_id = users.id"
/db optimize query --query "SELECT * FROM orders WHERE user_id = 123"
\`\`\`

## Schema Management

\`\`\`
/db schema
/db schema users
/db migrate status
/db migrate up
/db migrate create add_user_roles
\`\`\`

## Performance

\`\`\`
/db analyze --slow-queries
/db optimize table --table orders
\`\`\`

## Data Operations

\`\`\`
/db backup ./backups/production.sql --compress
/db seed ./seeds/test-data.json --truncate
\`\`\`

## Integrations

### PostgreSQL MCP

Set environment variables:
- POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
- Or: DATABASE_URL (connection string)

### MySQL MCP

Set environment variables:
- MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE

### MongoDB MCP

Set environment variables:
- MONGODB_URI: MongoDB connection string
- MONGODB_DATABASE: Default database name

## Supported Databases

PostgreSQL, MySQL/MariaDB, SQLite, MongoDB, Redis, Elasticsearch
`,
  argumentHint: "query|schema|migrate|analyze|optimize|explain|backup|seed [args]",
  mcpConfig: {
    postgres: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: {
        POSTGRES_URL: "${DATABASE_URL:-postgresql://localhost:5432/postgres}",
      },
    },
    sqlite: {
      command: "uvx",
      args: ["mcp-server-sqlite", "--db-path", "${SQLITE_PATH:-./database.db}"],
    },
  },
}

const oncallSkill: BuiltinSkill = {
  name: "oncall",
  description: "On-call management, alert handling, schedule management, and operational workflows for SRE and DevOps teams.",
  template: `# On-Call Operations Skill

On-call management, alert handling, and operational workflows.

## Commands

- \`/oncall status\` - Show current on-call status
- \`/oncall schedule [action]\` - View or manage schedules
- \`/oncall escalate <reason>\` - Escalate alert/incident
- \`/oncall acknowledge <target>\` - Acknowledge alert/incident
- \`/oncall handoff <to>\` - Hand off responsibilities
- \`/oncall runbook [search]\` - Find and display runbooks
- \`/oncall alerts [filter]\` - List and filter alerts
- \`/oncall metrics\` - Show on-call metrics

## Status & Alerts

\`\`\`
/oncall status --detailed
/oncall alerts --status triggered --severity critical
/oncall alerts --service api-gateway --since 24h
\`\`\`

## Alert Handling

\`\`\`
/oncall acknowledge ALR-123 --message "Investigating"
/oncall runbook --alert ALR-123
/oncall escalate "Need DBA expertise" --alert ALR-123
\`\`\`

## Schedule Management

\`\`\`
/oncall schedule
/oncall schedule swap --with @jane.smith --date 2026-01-05
/oncall schedule override --user @john.doe --duration 4h
\`\`\`

## Handoff

\`\`\`
/oncall handoff @jane.smith --active-items --notes "Watch ALR-123"
\`\`\`

## Metrics

\`\`\`
/oncall metrics --period month
\`\`\`

## Integrations

### PagerDuty

Set environment variables:
- PAGERDUTY_API_KEY: Your PagerDuty API key
- PAGERDUTY_SERVICE_ID: Default service ID (optional)

### Slack

Set environment variables:
- SLACK_BOT_TOKEN: Slack bot token (xoxb-...)
- SLACK_ONCALL_CHANNEL: Default on-call channel
`,
  argumentHint: "status|schedule|escalate|acknowledge|handoff|runbook|alerts|metrics [args]",
  mcpConfig: {
    pagerduty: {
      command: "uvx",
      args: ["pagerduty-mcp", "--enable-write-tools"],
      env: {
        PAGERDUTY_USER_API_KEY: "${PAGERDUTY_API_KEY}",
      },
    },
    slack: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: {
        SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}",
        SLACK_TEAM_ID: "${SLACK_TEAM_ID:-}",
      },
    },
  },
}

export function createBuiltinSkills(): BuiltinSkill[] {
  return [playwrightSkill, knowledgeSkill, debugSkill, deploySkill, projectSkill, testSkill, reviewSkill, incidentSkill, securitySkill, codeIndexSkill, perfSkill, apiSkill, dbSkill, oncallSkill]
}
