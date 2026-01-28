---
name: backend-pattern-go
description: Go backend development patterns and best practices
triggers:
  - golang backend
  - go api
  - go microservice
---

# Go Backend Patterns

## Project Structure
- `cmd/`: Entry points for applications.
- `internal/`: Private code that shouldn't be imported by other projects.
- `pkg/`: Public library code.
- Clean architecture principles (entities, use cases, controllers).

## Patterns
- **Error Handling**: Use `errors.Is` and `errors.As` for checking error types. Wrap errors with context using `%w`.
- **Context Propagation**: Always pass `context.Context` as the first argument to functions that perform I/O.
- **Interface-based Design**: Accept interfaces, return structs. Keep interfaces small (Proverb: "The bigger the interface, the weaker the abstraction").
- **Table-driven Tests**: Standard pattern for testing multiple scenarios in a single test function.
- **Concurrency**: Use channels for communication and `sync.WaitGroup` or `errgroup` for synchronization.
