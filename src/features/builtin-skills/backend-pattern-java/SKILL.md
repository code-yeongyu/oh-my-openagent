---
name: backend-pattern-java
description: Java/Spring backend patterns
triggers:
  - java backend
  - spring boot
  - java microservice
---

# Java Backend Patterns

## Patterns
- **Spring Boot Conventions**: Prefer annotation-driven configuration. Use `@RestController`, `@Service`, and `@Repository`.
- **Dependency Injection**: Use constructor injection over field injection for better testability and immutability.
- **Repository Pattern**: Leverage Spring Data JPA for data access. Use DTOs for data transfer between layers.
- **Exception Handling**: Use `@ControllerAdvice` and `@ExceptionHandler` for centralized error handling. Map domain exceptions to appropriate HTTP status codes.
- **Testing**: Use JUnit 5 and Mockito. Prefer `@WebMvcTest` for slice testing controllers and `@DataJpaTest` for repositories.
- **Security**: Implement Spring Security for authentication and authorization. Use JWT for stateless microservices.
