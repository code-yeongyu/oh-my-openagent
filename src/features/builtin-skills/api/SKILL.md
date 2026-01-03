# API Design Skill

API design, documentation, validation, and code generation for REST, GraphQL, and gRPC APIs.

## Commands

### `/api design <description>`

Design a new API from a natural language description.

**Arguments:**
- `description` (required): Natural language description of the API
- `--style`: API style: rest, graphql, grpc, event-driven (default: rest)
- `--version`: API version (default: v1)
- `--base-url`: Base URL for the API

**Example:**
```
/api design "User management API with CRUD operations, authentication, and role-based access"
/api design "Real-time chat service with rooms and direct messages" --style event-driven
/api design "Product catalog with search, filtering, and pagination" --style graphql
```

### `/api document <spec>`

Generate documentation from an API specification.

**Arguments:**
- `spec` (required): Path to OpenAPI/AsyncAPI/GraphQL spec
- `--format`: Output format: markdown, html, pdf (default: markdown)
- `--examples`: Include request/response examples

**Example:**
```
/api document ./openapi.yaml --format markdown
/api document ./schema.graphql --examples
```

### `/api validate <spec>`

Validate an API specification against best practices.

**Arguments:**
- `spec` (required): Path to API specification
- `--rules`: Ruleset to apply (default: spectral:oas)
- `--severity`: Minimum severity: error, warning, info

**Example:**
```
/api validate ./openapi.yaml
/api validate ./api.json --severity warning
/api validate ./asyncapi.yaml --rules asyncapi
```

### `/api generate <spec>`

Generate code from an API specification.

**Arguments:**
- `spec` (required): Path to API specification
- `--target`: What to generate: client, server, types, mocks
- `--lang`: Target language
- `--framework`: Target framework (optional)
- `--output`: Output directory

**Example:**
```
/api generate ./openapi.yaml --target client --lang typescript --framework axios
/api generate ./openapi.yaml --target server --lang python --framework fastapi
/api generate ./openapi.yaml --target types --lang go
```

### `/api test <spec>`

Test an API against its specification.

**Arguments:**
- `spec` (required): Path to API specification
- `--url`: Base URL of the API to test
- `--auth`: Authentication method and credentials
- `--coverage`: Report endpoint coverage

**Example:**
```
/api test ./openapi.yaml --url http://localhost:3000
/api test ./openapi.yaml --url https://api.example.com --auth "bearer:$TOKEN"
/api test ./openapi.yaml --url http://localhost:3000 --coverage
```

### `/api mock <spec>`

Start a mock server from an API specification.

**Arguments:**
- `spec` (required): Path to API specification
- `--port`: Port to run on (default: 4010)
- `--delay`: Simulated response delay in ms
- `--dynamic`: Generate dynamic responses

**Example:**
```
/api mock ./openapi.yaml --port 4010
/api mock ./openapi.yaml --delay 100 --dynamic
```

### `/api diff <old> <new>`

Compare two API specifications for breaking changes.

**Arguments:**
- `old` (required): Path to old specification
- `new` (required): Path to new specification
- `--format`: Output format: text, json, markdown

**Example:**
```
/api diff ./v1/openapi.yaml ./v2/openapi.yaml
/api diff main:openapi.yaml HEAD:openapi.yaml --format markdown
```

### `/api lint <spec>`

Lint an API specification for style and consistency.

**Arguments:**
- `spec` (required): Path to API specification
- `--ruleset`: Custom ruleset file
- `--fix`: Auto-fix issues where possible

**Example:**
```
/api lint ./openapi.yaml
/api lint ./openapi.yaml --ruleset .spectral.yaml
/api lint ./openapi.yaml --fix
```

## Integrations

### OpenAPI MCP

API specification tools via MCP.

Features:
- OpenAPI 3.x validation
- Schema generation
- Documentation rendering

### Postman MCP

Postman API platform integration.

**Environment variables:**
- `POSTMAN_API_KEY`: Postman API key

Features:
- Collection management
- API testing
- Mock servers
- Documentation

Get API key: https://go.postman.co/settings/me/api-keys

## Supported Formats

| Format | Design | Validate | Generate | Mock | Diff |
|--------|--------|----------|----------|------|------|
| OpenAPI 3.x | ✅ | ✅ | ✅ | ✅ | ✅ |
| OpenAPI 2.0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| AsyncAPI | ✅ | ✅ | ✅ | ✅ | ✅ |
| GraphQL | ✅ | ✅ | ✅ | ✅ | ✅ |
| gRPC/Protobuf | ✅ | ✅ | ✅ | ❌ | ✅ |
| JSON Schema | ❌ | ✅ | ✅ | ❌ | ✅ |

## Code Generation Targets

### Client Libraries
- TypeScript (axios, fetch, react-query)
- Python (requests, httpx, aiohttp)
- Go (net/http)
- Java (OkHttp, Spring WebClient)
- Rust (reqwest)

### Server Stubs
- TypeScript (Express, Fastify, NestJS)
- Python (FastAPI, Flask, Django)
- Go (Gin, Echo, Chi)
- Java (Spring Boot)
- Rust (Actix, Axum)

### Types Only
- TypeScript interfaces
- Python dataclasses/Pydantic
- Go structs
- Java records
- Rust structs

## Use Cases

### API-First Development
```
/api design "E-commerce order management API"
/api validate ./orders-api.yaml
/api generate ./orders-api.yaml --target server --lang typescript --framework express
/api generate ./orders-api.yaml --target client --lang typescript
```

### API Documentation
```
/api document ./openapi.yaml --format markdown --examples
```

### Contract Testing
```
/api mock ./openapi.yaml --port 4010
/api test ./openapi.yaml --url http://localhost:4010 --coverage
```

### Breaking Change Detection
```
/api diff ./main/openapi.yaml ./pr/openapi.yaml
```

## Best Practices

1. **Design first**: Write the spec before implementation
2. **Validate early**: Run `/api validate` in CI
3. **Document always**: Keep docs in sync with spec
4. **Test contracts**: Ensure implementation matches spec
5. **Version carefully**: Use `/api diff` before releases
6. **Lint consistently**: Enforce style with `/api lint`
