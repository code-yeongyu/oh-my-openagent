# Custom Architecture Guide

This guide explains how to define custom architectural patterns for projects that don't fit the standard patterns (Layered, Hexagonal, Clean, Feature-Based).

## When to Use Custom Architecture

Use a custom architecture when:

- Your project combines elements from multiple patterns
- You have domain-specific organizational needs
- Your team has established conventions that differ from standard patterns
- You're working with legacy code that has unique structure
- Your project type doesn't fit standard categories (embedded, games, data pipelines)

## Defining a Custom Architecture

### Step 1: Create Structure Definition

Create a `structure.yaml` file in your project's `.opencode/` directory:

```yaml
# .opencode/custom-architecture.yaml

pattern: custom
name: "data-pipeline"  # Give your pattern a descriptive name
description: "ETL pipeline architecture for data processing applications"

layers:
  - name: sources
    path: "src/sources"
    description: "Data source connectors and ingestion logic"
    agents_md: true  # Will generate AGENTS.md for this layer
    
  - name: transformers
    path: "src/transformers"
    description: "Data transformation and processing logic"
    agents_md: true
    
  - name: sinks
    path: "src/sinks"
    description: "Data output destinations and writers"
    agents_md: true
    
  - name: orchestration
    path: "src/orchestration"
    description: "Pipeline scheduling and workflow coordination"
    agents_md: true
    
  - name: models
    path: "src/models"
    description: "Data schemas and type definitions"
    agents_md: true

# Define what each layer can and cannot import
dependency_rules:
  sources:
    may_import:
      - models
    must_not_import:
      - transformers
      - sinks
      - orchestration
      
  transformers:
    may_import:
      - models
    must_not_import:
      - sources
      - sinks
      - orchestration
      
  sinks:
    may_import:
      - models
    must_not_import:
      - sources
      - transformers
      - orchestration
      
  orchestration:
    may_import:
      - sources
      - transformers
      - sinks
      - models
    must_not_import: []
    
  models:
    may_import: []
    must_not_import:
      - sources
      - transformers
      - sinks
      - orchestration
```

### Step 2: Create Layer AGENTS.md Files

For each layer, create an AGENTS.md file with instructions:

```markdown
# Sources Layer Instructions

## Purpose
This directory contains data source connectors that read data from external systems.

## Rules

1. **Single Source per File**: Each source connector handles one data source type
2. **Stateless Connections**: Sources should not maintain persistent state
3. **Error Handling**: Sources must handle connection failures gracefully
4. **Rate Limiting**: Implement rate limiting for API sources

## Patterns

### Source Interface
```python
class DataSource(Protocol):
    def connect(self) -> None: ...
    def read(self) -> Iterator[Record]: ...
    def close(self) -> None: ...
```

## Dependencies

- MAY import: models
- MUST NOT import: transformers, sinks, orchestration
```

### Step 3: Update project-context.yaml

Reference your custom architecture in the project context:

```yaml
architecture:
  pattern: custom
  custom_structure:
    name: "data-pipeline"
    description: "ETL pipeline architecture for data processing"
    config_file: ".opencode/custom-architecture.yaml"
  layers:
    - name: sources
      path: "src/sources"
      description: "Data source connectors"
    - name: transformers
      path: "src/transformers"
      description: "Data transformations"
    - name: sinks
      path: "src/sinks"
      description: "Data output destinations"
    - name: orchestration
      path: "src/orchestration"
      description: "Pipeline coordination"
    - name: models
      path: "src/models"
      description: "Data schemas"
```

## Custom Architecture Examples

### Example 1: Microkernel/Plugin Architecture

```yaml
pattern: custom
name: "microkernel"
description: "Microkernel architecture with plugin system"

layers:
  - name: core
    path: "src/core"
    description: "Minimal core system with extension points"
    
  - name: plugins
    path: "src/plugins"
    description: "Feature plugins that extend core functionality"
    
  - name: adapters
    path: "src/adapters"
    description: "External system adapters"
    
  - name: api
    path: "src/api"
    description: "Public API for plugin developers"

dependency_rules:
  core:
    may_import:
      - api
    must_not_import:
      - plugins
      - adapters
      
  plugins:
    may_import:
      - api
      - core
    must_not_import: []
    
  adapters:
    may_import:
      - api
    must_not_import:
      - core
      - plugins
      
  api:
    may_import: []
    must_not_import:
      - core
      - plugins
      - adapters
```

### Example 2: Event-Driven Architecture

```yaml
pattern: custom
name: "event-driven"
description: "Event-driven architecture with CQRS"

layers:
  - name: commands
    path: "src/commands"
    description: "Command handlers that modify state"
    
  - name: queries
    path: "src/queries"
    description: "Query handlers for read operations"
    
  - name: events
    path: "src/events"
    description: "Domain events and event handlers"
    
  - name: projections
    path: "src/projections"
    description: "Read model projections built from events"
    
  - name: aggregates
    path: "src/aggregates"
    description: "Domain aggregates and business logic"

dependency_rules:
  commands:
    may_import:
      - aggregates
      - events
    must_not_import:
      - queries
      - projections
      
  queries:
    may_import:
      - projections
    must_not_import:
      - commands
      - aggregates
      - events
      
  events:
    may_import: []
    must_not_import:
      - commands
      - queries
      - projections
      - aggregates
      
  projections:
    may_import:
      - events
    must_not_import:
      - commands
      - queries
      - aggregates
      
  aggregates:
    may_import:
      - events
    must_not_import:
      - commands
      - queries
      - projections
```

### Example 3: Component-Based (Game/UI)

```yaml
pattern: custom
name: "component-based"
description: "Entity-Component-System architecture for games"

layers:
  - name: entities
    path: "src/entities"
    description: "Entity definitions and factories"
    
  - name: components
    path: "src/components"
    description: "Pure data components attached to entities"
    
  - name: systems
    path: "src/systems"
    description: "Logic that operates on entities with specific components"
    
  - name: resources
    path: "src/resources"
    description: "Shared resources and assets"
    
  - name: scenes
    path: "src/scenes"
    description: "Scene management and level loading"

dependency_rules:
  entities:
    may_import:
      - components
    must_not_import:
      - systems
      - scenes
      
  components:
    may_import: []
    must_not_import:
      - entities
      - systems
      - resources
      - scenes
      
  systems:
    may_import:
      - entities
      - components
      - resources
    must_not_import:
      - scenes
      
  resources:
    may_import: []
    must_not_import:
      - entities
      - components
      - systems
      - scenes
      
  scenes:
    may_import:
      - entities
      - systems
      - resources
    must_not_import: []
```

## Hybrid Architectures

You can combine standard patterns with custom layers:

```yaml
pattern: custom
name: "layered-with-modules"
description: "Traditional layered architecture with modular organization"

layers:
  # Standard layers
  - name: api
    path: "src/api"
    description: "HTTP API layer"
    
  - name: services
    path: "src/services"
    description: "Business logic layer"
    
  - name: repositories
    path: "src/repositories"
    description: "Data access layer"
    
  # Custom additions
  - name: integrations
    path: "src/integrations"
    description: "Third-party service integrations"
    
  - name: jobs
    path: "src/jobs"
    description: "Background job processors"
    
  - name: websockets
    path: "src/websockets"
    description: "Real-time WebSocket handlers"

dependency_rules:
  api:
    may_import:
      - services
      - models
    must_not_import:
      - repositories
      - integrations
      
  services:
    may_import:
      - repositories
      - integrations
      - models
    must_not_import:
      - api
      - jobs
      - websockets
      
  # ... define rules for custom layers
```

## Best Practices for Custom Architectures

### 1. Document Your Decisions

Always include rationale for your architectural choices:

```yaml
considerations:
  pros:
    - "Separates read and write concerns for better scalability"
    - "Events provide audit trail and enable replay"
  cons:
    - "Eventual consistency requires careful handling"
    - "Higher complexity than CRUD"
    
rationale: |
  This architecture was chosen because our domain has:
  - High read-to-write ratio (100:1)
  - Regulatory requirements for audit trails
  - Need for event replay during debugging
```

### 2. Define Clear Boundaries

Be explicit about what crosses boundaries:

```yaml
boundaries:
  - name: "Command to Query"
    description: "Commands never query read models directly"
    allowed_communication: "Events only"
    
  - name: "External to Internal"
    description: "External systems communicate via API layer"
    allowed_communication: "HTTP/REST, message queue"
```

### 3. Include Migration Path

If transitioning from another architecture:

```yaml
migration:
  from: "monolith"
  strategy: "strangler-fig"
  phases:
    - name: "Extract shared"
      description: "Move common utilities to shared layer"
    - name: "Define boundaries"
      description: "Identify module boundaries in existing code"
    - name: "Gradual extraction"
      description: "Extract modules one at a time"
```

### 4. Provide Examples

Include example code in your AGENTS.md files:

```markdown
## Example: Creating a New Source

```python
# src/sources/postgres_source.py
from models import Record
from .base import DataSource

class PostgresSource(DataSource):
    def __init__(self, connection_string: str):
        self.connection_string = connection_string
        self.conn = None
        
    def connect(self) -> None:
        self.conn = psycopg2.connect(self.connection_string)
        
    def read(self) -> Iterator[Record]:
        cursor = self.conn.cursor()
        cursor.execute(self.query)
        for row in cursor:
            yield Record.from_tuple(row)
            
    def close(self) -> None:
        if self.conn:
            self.conn.close()
```
```

## Validating Your Architecture

After defining your custom architecture:

1. **Verify Layer Independence**: Ensure layers can be tested in isolation
2. **Check Dependency Flow**: Confirm dependencies flow in one direction
3. **Test Boundary Enforcement**: Use linting tools to catch violations
4. **Review with Team**: Get buy-in from all team members
5. **Document Exceptions**: If rules must be broken, document why

## Template Variables

When creating AGENTS.md files for custom architectures, you can use these template variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{layer.name}}` | Layer identifier | `sources` |
| `{{layer.path}}` | Relative path | `src/sources` |
| `{{layer.description}}` | Layer description | `Data source connectors` |
| `{{architecture.name}}` | Custom architecture name | `data-pipeline` |
| `{{architecture.pattern}}` | Pattern type | `custom` |

## Next Steps

1. Copy this guide and examples to your project
2. Modify the structure.yaml to match your needs
3. Create AGENTS.md files for each layer
4. Update your project-context.yaml
5. Share with your team for feedback

