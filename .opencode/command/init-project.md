---
name: init-project
description: Initialize OpenCode configuration for new or existing projects
agent: orchestrator
---

# Initialize Project for OpenCode

You are initializing this project for OpenCode-based agentic development. This is an interactive command that guides users through project setup.

## Purpose

This command:
1. Gathers project information
2. Detects or selects technology stack
3. Chooses architecture pattern with intelligent suggestions
4. Configures integrations (Linear, Mintlify)
5. Generates configuration files
6. Creates architecture-specific AGENTS.md files

---

## Interactive Flow

### Step 1: Check for Existing Configuration

**First**, check if `.opencode/` already exists:

```
📂 Checking for existing OpenCode configuration...

{If .opencode/ exists}:
⚠️  **Existing Configuration Found**

An `.opencode/` directory already exists. What would you like to do?

- [ ] **Overwrite** - Remove existing config and start fresh
- [ ] **Merge** - Keep existing config and update missing parts
- [ ] **Cancel** - Exit without changes

> [User selection]
```

### Step 2: Project Information

Gather basic project details:

```
🚀 **OpenCode Project Initialization**

Let's set up your project for AI-assisted development.

---

**1. Project Name**
What is the name of this project?
> [User input or detect from package.json/pyproject.toml/go.mod/Cargo.toml]

**2. Project Description**  
Brief description of what this project does:
> [User input]

**3. Project Type**
What type of project is this?
1. Web Application (frontend + backend)
2. API Service (backend only)
3. CLI Tool
4. Library/Package
5. Monorepo (multiple packages)
6. Mobile Application
7. Desktop Application
8. Other

> [Select 1-8]

**4. New or Existing?**
1. New project (starting fresh)
2. Existing project (adding OpenCode to existing codebase)

> [Select 1-2]
```

### Step 3: Technology Stack Detection (Existing Projects)

For existing projects, scan for configuration files:

```
🔍 **Scanning project for technology stack...**

Scanning for configuration files...
```

**Files to Detect:**

| File | Indicates | Parse For |
|------|-----------|-----------|
| `package.json` | Node.js/JavaScript | dependencies, devDependencies, engines |
| `tsconfig.json` | TypeScript | compilerOptions.target |
| `pyproject.toml` | Python | python version, dependencies |
| `requirements.txt` | Python | package versions |
| `go.mod` | Go | module name, go version |
| `Cargo.toml` | Rust | edition, dependencies |
| `pom.xml` | Java | java version, dependencies |
| `build.gradle` | Java/Kotlin | plugins, dependencies |
| `composer.json` | PHP | php version, dependencies |
| `Gemfile` | Ruby | ruby version, gems |
| `.python-version` | Python | exact version |
| `.nvmrc` / `.node-version` | Node.js | exact version |

**Framework Detection from Dependencies:**

| Dependency | Framework Type |
|------------|---------------|
| `react`, `react-dom` | Frontend: React |
| `vue` | Frontend: Vue |
| `svelte` | Frontend: Svelte |
| `next` | Frontend: Next.js |
| `@angular/core` | Frontend: Angular |
| `express` | Backend: Express |
| `fastify` | Backend: Fastify |
| `@nestjs/core` | Backend: NestJS |
| `hono` | Backend: Hono |
| `fastapi` | Backend: FastAPI |
| `django` | Backend: Django |
| `flask` | Backend: Flask |
| `prisma` | ORM: Prisma |
| `drizzle-orm` | ORM: Drizzle |
| `typeorm` | ORM: TypeORM |
| `sqlalchemy` | ORM: SQLAlchemy |
| `jest` | Testing: Jest |
| `vitest` | Testing: Vitest |
| `pytest` | Testing: pytest |
| `playwright` | Testing: Playwright |
| `cypress` | Testing: Cypress |

**Database Detection:**
- Check for `docker-compose.yml` with database services
- Look for database config files
- Parse ORM configuration files

**Display Detection Results:**

```
📊 **Technology Stack Detected:**

**Languages:**
- TypeScript 5.3 (from tsconfig.json)
- Python 3.12 (from pyproject.toml)

**Frameworks:**
- Frontend: React 18.2.0 (from package.json)
- Backend: FastAPI 0.109.0 (from requirements.txt)

**Testing:**
- Vitest (unit)
- Playwright (e2e)
- pytest (unit)

**Database:**
- PostgreSQL (from docker-compose.yml)
- ORM: Prisma

**Package Manager:**
- pnpm (detected from pnpm-lock.yaml)

---

Is this correct? [Y/n]
Would you like to add or modify anything? [y/N]
```

### Step 4: Technology Selection (New Projects)

For new projects, present selection interface:

```
🛠️ **Technology Stack Selection**

**Languages** (select all that apply):
1. TypeScript
2. JavaScript  
3. Python
4. Go
5. Rust
6. Java
7. C#
8. Ruby
9. PHP
10. Other: [specify]

> [Enter numbers separated by commas, e.g., "1,3"]

{Based on language selection, show relevant options}

**Frontend Framework** (if applicable):
1. React
2. Vue
3. Svelte
4. Angular
5. Next.js (React SSR)
6. Nuxt (Vue SSR)
7. SvelteKit
8. Astro
9. None (API only)

> [Select 1-9]

**Backend Framework** (if applicable):
{For TypeScript/JavaScript:}
1. Express
2. Fastify
3. NestJS
4. Hono
5. None

{For Python:}
1. FastAPI
2. Django
3. Flask
4. None

{For Go:}
1. Gin
2. Echo
3. net/http (stdlib)
4. None

> [Select option]

**Database** (if applicable):
1. PostgreSQL
2. MySQL
3. MongoDB
4. SQLite
5. Redis (cache only)
6. None

> [Select 1-6]

{If database selected:}
**ORM/Query Builder:**
{For TypeScript:}
1. Prisma
2. Drizzle
3. TypeORM
4. None (raw SQL)

{For Python:}
1. SQLAlchemy
2. Django ORM (if Django)
3. None (raw SQL)

> [Select option]

**Package Manager:**
{For JavaScript/TypeScript:}
1. npm
2. pnpm (recommended)
3. yarn
4. bun

{For Python:}
1. pip
2. poetry
3. uv (recommended)

> [Select option]
```

### Step 5: Architecture Pattern Selection

Based on project type, suggest optimal architecture:

```
🏗️ **Architecture Pattern Selection**

Based on your {project_type} with {tech_stack}, I recommend:

**✨ Recommended: {recommended_pattern}**
{reason for recommendation}

---

**Available Patterns:**

1. **Layered (Repository-Service-Controller)** {⭐ if recommended}
   Traditional separation of concerns
   Best for: APIs, standard web apps
   Structure: src/controllers/ → src/services/ → src/repositories/ → src/models/
   
2. **Hexagonal (Ports & Adapters)** {⭐ if recommended}
   Maximum testability, dependency inversion
   Best for: Complex domains, many integrations
   Structure: src/domain/ → src/ports/ → src/adapters/ → src/application/
   
3. **Clean Architecture** {⭐ if recommended}
   Enterprise patterns, strict dependency rules
   Best for: Large teams, long-lived projects
   Structure: src/entities/ → src/use-cases/ → src/interfaces/ → src/frameworks/
   
4. **Feature-Based (Vertical Slices)** {⭐ if recommended}
   Co-located by feature
   Best for: Rapid development, small teams
   Structure: src/features/{feature}/ (self-contained)
   
5. **Custom**
   Define your own layer structure

> Select pattern [1-5]:
```

**Suggestion Mapping:**

| Project Type | Primary Recommendation | Alternative | Reason |
|--------------|----------------------|-------------|--------|
| Web Application | Layered | Feature-Based | Clear separation, easy to understand |
| API Service | Layered | Hexagonal | Standard REST patterns fit well |
| CLI Tool | Simple (no pattern) | - | Typically straightforward |
| Library | Hexagonal | Clean | Need to isolate from consumers |
| Monorepo | Feature-Based | - | Each package is self-contained |
| Enterprise | Clean Architecture | Hexagonal | Strict boundaries, large team |
| Complex Domain | Hexagonal | Clean | Domain isolation critical |

**If Custom Selected:**

```
📐 **Custom Architecture Definition**

Define your custom layer structure:

**Layer 1 Name:** [e.g., "core"]
**Layer 1 Path:** [e.g., "src/core"]
**Layer 1 Description:** [e.g., "Core business logic"]

**Add another layer?** [Y/n]

**Layer 2 Name:** [e.g., "api"]
**Layer 2 Path:** [e.g., "src/api"]  
**Layer 2 Description:** [e.g., "HTTP handlers"]

{Continue until done}

**Dependency Rules:**
Which layers can {layer1} import from?
> [Enter layer names or "none"]

Which layers can {layer2} import from?
> [Enter layer names or "none"]
```

### Step 6: Linear Integration Setup

```
📋 **Linear Integration**

OpenCode uses Linear for project management, issue tracking, and branch naming.

---

**Checking for LINEAR_API_KEY...**

{If found in environment}:
✅ LINEAR_API_KEY found

{If not found}:
⚠️  LINEAR_API_KEY not found in environment

To set up Linear integration:
1. Go to Linear → Settings → API → Personal API Keys
2. Create a new key with full access
3. Add to your environment:
   
   # macOS/Linux (add to ~/.zshrc or ~/.bashrc):
   export LINEAR_API_KEY="lin_api_..."
   
   # Windows PowerShell (add to profile):
   $env:LINEAR_API_KEY="lin_api_..."

Options:
1. I've added the key - continue
2. Skip Linear setup (not recommended - issues required for tracking)

> [Select 1-2]
```

**If Linear Available:**

```
🔍 **Fetching your Linear teams...**

**Available Teams:**
1. {Team Name} (KEY1)
2. {Team Name} (KEY2)
3. {Team Name} (KEY3)

> Select team [1-n]:

---

**Project Setup:**
1. Create new Linear project for this codebase
2. Use existing project: [show list]
3. Skip project selection (use team-level tracking)

> [Select 1-3]

{If creating new project}:
**Project Name:** [{project_name} - default]
> [Enter name or press enter for default]

**Project Description:** 
> [Optional description]
```

### Step 7: Mintlify Configuration

```
📚 **Documentation Setup**

Would you like to set up Mintlify for documentation?
- Architecture specs, API docs, and guides will be published here
- Integrates with OpenCode's documentation agents

1. Yes, set up Mintlify (recommended for teams)
2. No, use local markdown only

> [Select 1-2]

{If yes}:
**Documentation path** [default: docs/]:
> [Enter path or press enter for default]

Creating Mintlify structure:
✅ {docs_path}/mint.json - Mintlify configuration
✅ {docs_path}/introduction.mdx - Welcome page
✅ {docs_path}/architecture/overview.mdx - Architecture docs
✅ {docs_path}/api-reference/ - API documentation
✅ {docs_path}/guides/ - How-to guides
```

### Step 8: Generate Configuration Files

```
⚙️ **Generating Configuration**

Creating OpenCode configuration files...

✅ .opencode/opencode.json
   - Model configuration
   - Tool permissions
   - Linear MCP setup
   - LSP servers for {detected languages}

✅ .opencode/project-context.yaml
   - Project metadata
   - Technology stack
   - Architecture definition
   - Integration settings
   - Coding conventions

✅ AGENTS.md (project root)
   - Project overview
   - Tech stack summary
   - Architecture guidance
   - Workflow rules

{For each architecture layer}:
✅ {layer_path}/AGENTS.md
   - Layer-specific instructions
   - Dependency rules
   - Code patterns
   - Do's and Don'ts

{If Mintlify enabled}:
✅ {docs_path}/mint.json
✅ {docs_path}/introduction.mdx
✅ {docs_path}/architecture/overview.mdx

Updating .gitignore:
✅ Added .opencode/local.json (for local overrides)
✅ Added .opencode/*.local.* (for local configs)
```

### Step 9: Summary and Next Steps

```
🎉 **Project Initialized Successfully!**

═══════════════════════════════════════════════════════════════════════════

## Configuration Summary

**Project**: {project_name}
**Type**: {project_type}
**Architecture**: {architecture_pattern}

**Technology Stack:**
┌─────────────────────────────────────────────────────────────────────────┐
│ Languages    │ {languages with versions}                                │
│ Frontend     │ {frontend framework or "None"}                           │
│ Backend      │ {backend framework or "None"}                            │
│ Database     │ {database + ORM or "None"}                               │
│ Package Mgr  │ {package_manager}                                        │
└─────────────────────────────────────────────────────────────────────────┘

**Integrations:**
┌─────────────────────────────────────────────────────────────────────────┐
│ Linear       │ {team_name} / {project_name or "Team-level"}            │
│ Mintlify     │ {docs_path or "Disabled"}                               │
└─────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

## Files Created

**Configuration:**
- `.opencode/opencode.json` - Main OpenCode configuration
- `.opencode/project-context.yaml` - Project context and metadata

**Instructions:**
- `AGENTS.md` - Root project instructions for AI agents
{For each layer}:
- `{layer_path}/AGENTS.md` - {layer_name} layer instructions

{If Mintlify}:
**Documentation:**
- `{docs_path}/mint.json` - Mintlify configuration
- `{docs_path}/introduction.mdx` - Documentation home
- `{docs_path}/architecture/overview.mdx` - Architecture overview

═══════════════════════════════════════════════════════════════════════════

## Available Agents

| Agent | Purpose | Invoke With |
|-------|---------|-------------|
| orchestrator | Route requests to optimal agents | @orchestrator |
| product-strategist | Requirements, user stories, PRDs | @product-strategist |
| strategic-architect | System design, ADRs | @strategic-architect |
| linear-coordinator | Linear tickets, branches | @linear-coordinator |
| implementation-specialist | Production code | @implementation-specialist |
| quick-fixer | Bug fixes, hotfixes | @quick-fixer |
| code-reviewer | Code reviews, audits | @code-reviewer |
| test-engineer | Tests, coverage | @test-engineer |
| documentation-master | Docs, API specs | @documentation-master |
| project-guru | Codebase explanations | @project-guru |

═══════════════════════════════════════════════════════════════════════════

## Next Steps

### 1. Review Generated Files
```bash
# Check configuration
cat .opencode/opencode.json
cat .opencode/project-context.yaml

# Review AGENTS.md files
cat AGENTS.md
{for each layer}:
cat {layer_path}/AGENTS.md
```

### 2. Start Your First Task

**Plan a feature:**
```
@orchestrator Plan the first feature for this project
```

**Ask about the project:**
```
@project-guru Explain the project architecture
```

**Create a Linear issue:**
```
@linear-coordinator Create issue "Set up CI/CD pipeline"
```

### 3. Quick Reference

| Command | Description |
|---------|-------------|
| `/init-project` | Re-run initialization |
| `@orchestrator help` | Show available workflows |
| `@orchestrator {request}` | Route any request |

═══════════════════════════════════════════════════════════════════════════

**Happy coding!** 🚀

Need help? Ask `@project-guru` to explain anything about your setup.
```

---

## Template References

When generating files, use these templates from `.opencode/templates/`:

### Architecture Templates
- `architectures/layered/structure.yaml` - Layer definitions
- `architectures/layered/*-AGENTS.md` - Layer AGENTS.md templates
- `architectures/hexagonal/structure.yaml`
- `architectures/hexagonal/*-AGENTS.md`
- `architectures/clean/structure.yaml`
- `architectures/clean/*-AGENTS.md`
- `architectures/feature-based/structure.yaml`
- `architectures/feature-based/*-AGENTS.md`
- `architectures/custom/guide.md` - Custom architecture guide

### Project Context
- `project-context.schema.yaml` - Schema definition
- `project-context.example.yaml` - Example configuration

### Root AGENTS.md
- `root-AGENTS.md.template` - Handlebars template for root AGENTS.md

### LSP Configuration
- `lsp/typescript.json`
- `lsp/python.json`
- `lsp/go.json`
- `lsp/rust.json`
- `lsp/java.json`
- `lsp/ruby.json`

---

## File Generation Specifications

### opencode.json Generation

Generate based on detected/selected technologies:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/gemini-3-flash",
  "small_model": "anthropic/claude-haiku-3",
  
  "permission": {
    "edit": "allow",
    "bash": {
      "*": "ask",
      "git status": "allow",
      "git diff": "allow",
      "git log": "allow",
      "git branch": "allow",
      "{test_command}": "allow",
      "{lint_command}": "allow"
    },
    "webfetch": "ask"
  },
  
  "share": "manual",
  "tools": {},
  
  "mcp": {
    "linear": {
      "type": "remote",
      "url": "https://mcp.linear.app/mcp",
      "enabled": {linear_enabled},
      "headers": {
        "Authorization": "Bearer {env:LINEAR_API_KEY}"
      }
    }
  },
  
  "lsp": {
    // Include only for detected/selected languages
    "{language}": {
      // From .opencode/templates/lsp/{language}.json
    }
  },
  
  "instructions": [
    ".opencode/instructions/governance.md",
    ".opencode/instructions/linear-workflow.md",
    ".opencode/instructions/documentation-standards.md"
  ]
}
```

### project-context.yaml Generation

Follow schema from `project-context.schema.yaml`:

```yaml
# Generated by init-project on {date}
# OpenCode Project Context

project:
  name: "{user_input}"
  description: "{user_input}"
  type: "{selected_type}"
  version: "0.1.0"

tech_stack:
  languages:
    - name: "{detected/selected}"
      version: "{version}"
      primary: true
  
  frameworks:
    frontend:
      name: "{detected/selected}"
      version: "{version}"
    backend:
      name: "{detected/selected}"
      version: "{version}"
    testing:
      - name: "{detected/selected}"
        type: "unit"
  
  databases:
    - type: "{detected/selected}"
      name: "main"
      orm: "{detected/selected}"
  
  package_manager: "{detected/selected}"

architecture:
  pattern: "{selected_pattern}"
  layers:
    # From architecture template
    - name: "{layer_name}"
      path: "{layer_path}"
      description: "{layer_description}"
      agents_md: true

integrations:
  linear:
    enabled: {true/false}
    team_id: "{selected_team_id}"
    project_id: "{selected_or_created_project_id}"
    workflow:
      require_issue: true
      auto_transition: false
  
  mintlify:
    enabled: {true/false}
    docs_path: "{selected_path}"
    config_file: "mint.json"

conventions:
  naming:
    files: "kebab-case"
    functions: "camelCase"
    classes: "PascalCase"
    constants: "SCREAMING_SNAKE_CASE"
    components: "PascalCase"
  
  code_style:
    indent: 2
    indent_style: "spaces"
    quotes: "double"
    semicolons: true
    trailing_commas: true
    max_line_length: 100
    formatter: "{detected_formatter}"
  
  commit_format: "conventional"
  branch_naming: "{type}/{issue-id}-{description}"

metadata:
  created_at: "{ISO_timestamp}"
  updated_at: "{ISO_timestamp}"
  opencode_version: "1.0.0"
  schema_version: "1.0.0"
```

### AGENTS.md Generation

Use `root-AGENTS.md.template` with project-context.yaml data to generate root AGENTS.md.

For layer-specific AGENTS.md files, copy from architecture templates:
- Read `.opencode/templates/architectures/{pattern}/{layer}-AGENTS.md`
- Copy to `{layer_path}/AGENTS.md`

### Mintlify mint.json Generation

```json
{
  "$schema": "https://mintlify.com/schema.json",
  "name": "{project_name}",
  "logo": {
    "dark": "/logo/dark.svg",
    "light": "/logo/light.svg"
  },
  "favicon": "/favicon.svg",
  "colors": {
    "primary": "#0D9373",
    "light": "#07C983",
    "dark": "#0D9373"
  },
  "topbarLinks": [],
  "topbarCtaButton": {
    "name": "GitHub",
    "url": "{github_url}"
  },
  "tabs": [
    {
      "name": "API Reference",
      "url": "api-reference"
    }
  ],
  "navigation": [
    {
      "group": "Getting Started",
      "pages": [
        "introduction"
      ]
    },
    {
      "group": "Architecture",
      "pages": [
        "architecture/overview"
      ]
    },
    {
      "group": "Guides",
      "pages": []
    }
  ],
  "footerSocials": {}
}
```

---

## Edge Case Handling

### Existing .opencode/ Directory
- **Detect**: Check if `.opencode/` exists
- **Options**: Overwrite, Merge, Cancel
- **Merge Strategy**: Keep existing files, add missing ones, update metadata

### No LINEAR_API_KEY
- **Detect**: Check environment for `LINEAR_API_KEY`
- **Handle**: Provide setup instructions, allow skip
- **Skip Consequence**: `integrations.linear.enabled = false`

### Unrecognized Technology Stack
- **Detect**: No standard config files found
- **Handle**: Fall back to manual selection interface
- **Allow**: "Other" options with custom input

### Custom Architecture Pattern
- **Trigger**: User selects option 5 (Custom)
- **Guide**: Interactive layer definition
- **Generate**: Custom AGENTS.md files with user-provided content
- **Template**: Use `.opencode/templates/architectures/custom/guide.md`

### Monorepo Structure
- **Detect**: Look for `lerna.json`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`
- **Handle**: Ask about per-package vs root configuration
- **Generate**: Root config + per-package AGENTS.md files

### Network Unavailable
- **Detect**: Linear API calls fail
- **Handle**: Skip Linear setup, use local-only mode
- **Note**: Inform user Linear can be configured later

---

## Validation Requirements

After generation, verify:
- [ ] `opencode.json` is valid JSON
- [ ] `project-context.yaml` is valid YAML matching schema
- [ ] All referenced AGENTS.md files exist
- [ ] Layer paths are valid and consistent
- [ ] Linear integration (if enabled) can authenticate
- [ ] Mintlify structure (if enabled) is complete

---

## Command Metadata

- **Estimated Time**: 3-5 minutes interactive
- **Requires**: User interaction for selections
- **Creates**: 5-15 files depending on architecture
- **Modifies**: `.gitignore` (adds OpenCode ignores)
- **Network**: Linear API (optional), no other network required

