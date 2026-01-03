# Test Skill

Enterprise testing skill supporting all major languages: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, and C#.

## Commands

- `/test run [pattern]` - Run tests with optional pattern filter
- `/test generate <file>` - Generate tests for a source file
- `/test coverage [directory]` - Analyze code coverage
- `/test matrix <parameters>` - Generate pairwise test combinations

## Supported Languages & Frameworks

| Language | Unit Testing | Property-Based | Coverage |
|----------|--------------|----------------|----------|
| TypeScript/JS | Jest, Vitest, Mocha | fast-check | Istanbul, c8 |
| Python | pytest, unittest | Hypothesis | coverage.py, pytest-cov |
| Go | go test, Testify, Ginkgo | rapid | go cover, gocov |
| Rust | cargo test | proptest, quickcheck | tarpaulin, llvm-cov |
| Java/Kotlin | JUnit, TestNG, Spock | jqwik | JaCoCo, Kover |
| C# | xUnit, NUnit, MSTest | FsCheck | Coverlet |

## Test Execution

### Auto-Detect Language

```
/test run                           # Detects from project files
/test run --language python         # Explicit language
/test run --framework pytest        # Explicit framework
```

### Language-Specific Examples

**TypeScript/JavaScript**
```
/test run --file src/auth.test.ts
bun test / npm test / vitest
```

**Python**
```
/test run --file tests/test_auth.py
pytest / python -m unittest
```

**Go**
```
/test run --file auth_test.go
go test ./...
```

**Rust**
```
/test run --file src/auth.rs
cargo test
```

**Java**
```
/test run --file AuthTest.java
mvn test / gradle test
```

### Common Options

```
/test run --coverage              # With coverage report
/test run --watch                 # Watch mode
/test run --parallel              # Parallel execution
/test run --tags integration      # Filter by tags
/test run --bail                  # Stop on first failure
```

## Test Generation

### Unit Tests

```
/test generate src/utils/parser.ts --type unit
/test generate app/services/auth.py --type unit --mocks
/test generate pkg/handler/user.go --type unit
/test generate src/lib.rs --type unit
/test generate UserService.java --type unit --framework junit
```

### Integration Tests

```
/test generate src/api/users.ts --type integration
/test generate app/api/endpoints.py --type integration --fixtures
/test generate internal/api/handler.go --type integration
```

### Property-Based Tests

```
/test generate src/parser.ts --type property          # fast-check
/test generate app/utils/parser.py --type property    # Hypothesis
/test generate pkg/parser/parse.go --type property    # rapid
/test generate src/parser.rs --type property          # proptest
/test generate Parser.java --type property            # jqwik
```

### E2E Tests

```
/test generate src/pages/login.tsx --type e2e --framework playwright
/test generate app/views/login.py --type e2e --framework playwright
```

### Benchmarks

```
/test generate src/heavy.ts --type benchmark          # Vitest bench
/test generate app/utils/heavy.py --type benchmark    # pytest-benchmark
/test generate pkg/heavy/compute.go --type benchmark  # go test -bench
/test generate src/heavy.rs --type benchmark          # cargo bench
/test generate Heavy.java --type benchmark            # JMH
```

## Coverage Analysis

### By Language

**TypeScript/JavaScript**
```
/test coverage --reporter html,lcov
# Tools: Istanbul, c8, Vitest coverage
```

**Python**
```
/test coverage --reporter html,xml
# Tools: coverage.py, pytest-cov
```

**Go**
```
/test coverage --reporter html
# Tools: go cover, gocov, gocov-html
```

**Rust**
```
/test coverage --reporter html,lcov
# Tools: cargo-tarpaulin, cargo-llvm-cov, grcov
```

**Java/Kotlin**
```
/test coverage --reporter jacoco,cobertura
# Tools: JaCoCo, Kover, Cobertura
```

**C#**
```
/test coverage --reporter cobertura,opencover
# Tools: Coverlet, dotCover, OpenCover
```

### Thresholds

```
/test coverage --threshold lines:80,branches:70,functions:90
```

## Test Matrix (PICT)

Generate efficient pairwise test combinations for any language.

### Basic Matrix

```
/test matrix browser:chrome,firefox,safari os:windows,mac,linux
```

### With Constraints

```
/test matrix \
  database:postgres,mysql,sqlite \
  cache:redis,memcached,none \
  queue:rabbitmq,kafka,sqs \
  --constraint "if database=sqlite then cache=none"
```

### Output as Code

```
/test matrix ... --language python --output code
/test matrix ... --language go --output code
/test matrix ... --language rust --output code
```

### API Testing Matrix

```
/test matrix \
  method:GET,POST,PUT,DELETE,PATCH \
  auth:none,basic,bearer,oauth2,apikey \
  contentType:json,xml,protobuf,msgpack \
  compression:none,gzip,br
```

## Language-Specific Patterns

### TypeScript/JavaScript (Jest/Vitest)
```typescript
describe('UserService', () => {
  it('should create user', async () => {
    // Arrange, Act, Assert
  })
})
```

### Python (pytest)
```python
class TestUserService:
    def test_create_user(self):
        # Arrange, Act, Assert

    @pytest.mark.parametrize("input,expected", [...])
    def test_validation(self, input, expected):
        ...
```

### Go (go test)
```go
func TestCreateUser(t *testing.T) {
    // Arrange, Act, Assert
}

func TestCreateUser_TableDriven(t *testing.T) {
    tests := []struct{ name string; input Input; want Output }{...}
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {...})
    }
}
```

### Rust (cargo test)
```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_create_user() {
        // Arrange, Act, Assert
    }
    
    #[test]
    #[should_panic(expected = "validation error")]
    fn test_invalid_input() {...}
}
```

### Java (JUnit 5)
```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {
    @Mock UserRepository repository;
    @InjectMocks UserService service;
    
    @Test
    void shouldCreateUser() {
        // Arrange, Act, Assert
    }
    
    @ParameterizedTest
    @CsvSource({"input1,expected1", "input2,expected2"})
    void shouldValidate(String input, String expected) {...}
}
```

## Integrations

### Playwright (E2E - All Languages)

Cross-language browser automation:
- TypeScript/JavaScript: Native Playwright
- Python: playwright-python
- Java: playwright-java
- C#: playwright-dotnet

### CI/CD Integration

All frameworks support standard CI outputs:
- JUnit XML (universal)
- TAP format
- JSON reports
- Coverage: Cobertura, LCOV, JaCoCo
