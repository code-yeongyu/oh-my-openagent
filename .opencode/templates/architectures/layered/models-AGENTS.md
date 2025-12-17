# Models Layer Instructions

## Purpose

This directory contains data models and type definitions. Models define the shape of data throughout the application, including entities, DTOs, and schemas.

## Responsibilities

- Define domain entities with their properties
- Define Data Transfer Objects (DTOs) for layer communication
- Define request/response schemas
- Define database schemas (if using ORM)
- Provide type safety across the application

## Rules

### 1. Pure Data Structures
Models should be pure data structures without business logic.

```typescript
// ✅ GOOD: Pure data structure
interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

// ❌ BAD: Business logic in model
class User {
  // ...properties...
  
  isActive(): boolean {
    return this.lastLoginAt > thirtyDaysAgo;
  }
  
  async save(): Promise<void> {
    await db.users.update(this.id, this);
  }
}
```

### 2. Separate DTOs from Entities
Use different types for different purposes.

```typescript
// Entity - internal representation
interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
}

// CreateDTO - for creation operations
interface CreateUserDTO {
  email: string;
  name: string;
  password: string;  // Plain password, not hash
}

// UpdateDTO - for update operations (all optional)
interface UpdateUserDTO {
  email?: string;
  name?: string;
  password?: string;
}

// ResponseDTO - for API responses (no sensitive data)
interface UserResponse {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}
```

### 3. Immutability
Prefer immutable data structures when possible.

```typescript
// ✅ GOOD: Immutable with readonly
interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly createdAt: Date;
}

// Or use classes with readonly properties
class User {
  constructor(
    public readonly id: string,
    public readonly email: string,
    public readonly name: string,
    public readonly createdAt: Date,
  ) {}
  
  // Return new instance for updates
  withName(name: string): User {
    return new User(this.id, this.email, name, this.createdAt);
  }
}
```

### 4. No External Dependencies
Models should not import from other layers.

### 5. Validation Schemas Alongside Types
Keep validation schemas close to type definitions.

```typescript
// user.ts
import { z } from "zod";

// Validation schema
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  createdAt: z.date(),
});

// Infer type from schema
export type User = z.infer<typeof UserSchema>;

// Create DTO schema
export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8),
});

export type CreateUserDTO = z.infer<typeof CreateUserSchema>;
```

## Patterns

### Entity Definition

```typescript
// entities/user.ts
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = "admin" | "member" | "guest";
export type UserStatus = "active" | "inactive" | "suspended";
```

### DTO Definitions

```typescript
// dto/user-dto.ts
export interface CreateUserDTO {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
}

export interface UpdateUserDTO {
  email?: string;
  name?: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface UserFilters {
  role?: UserRole;
  status?: UserStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}
```

### Response DTOs

```typescript
// dto/user-response.ts
export interface UserResponse {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export interface UserListResponse {
  data: UserResponse[];
  pagination: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
```

### Value Objects

```typescript
// value-objects/email.ts
export class Email {
  private constructor(public readonly value: string) {}
  
  static create(value: string): Email {
    if (!Email.isValid(value)) {
      throw new InvalidEmailError(value);
    }
    return new Email(value.toLowerCase());
  }
  
  static isValid(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  
  equals(other: Email): boolean {
    return this.value === other.value;
  }
}
```

### Database Models (Prisma Example)

```typescript
// prisma/schema.prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String
  password  String
  role      UserRole @default(MEMBER)
  status    UserStatus @default(ACTIVE)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  teams     TeamMember[]
  posts     Post[]
}

enum UserRole {
  ADMIN
  MEMBER
  GUEST
}

enum UserStatus {
  ACTIVE
  INACTIVE
  SUSPENDED
}
```

## File Organization

```
models/
├── entities/
│   ├── user.ts
│   ├── team.ts
│   └── post.ts
├── dto/
│   ├── user-dto.ts
│   ├── team-dto.ts
│   └── post-dto.ts
├── value-objects/
│   ├── email.ts
│   └── money.ts
├── schemas/
│   ├── user-schema.ts
│   └── team-schema.ts
└── index.ts  # Re-exports all models
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Entity Files | `{entity}.ts` | `user.ts` |
| DTO Files | `{entity}-dto.ts` | `user-dto.ts` |
| Schema Files | `{entity}-schema.ts` | `user-schema.ts` |
| Entity Types | `{Entity}` | `User` |
| Create DTOs | `Create{Entity}DTO` | `CreateUserDTO` |
| Update DTOs | `Update{Entity}DTO` | `UpdateUserDTO` |
| Response DTOs | `{Entity}Response` | `UserResponse` |
| Filters | `{Entity}Filters` | `UserFilters` |

## Dependencies

### MAY Import
- Other models (for composition)
- Validation libraries (Zod, Yup, etc.)
- Type utilities

### MUST NOT Import
- Controllers (`../controllers/`)
- Services (`../services/`)
- Repositories (`../repositories/`)
- Database clients (except ORM schema definitions)

## Testing

### Type Tests

```typescript
// Use TypeScript's type checking for compile-time validation
import { expectType } from "tsd";

// Verify DTO compatibility
const createDTO: CreateUserDTO = {
  email: "test@example.com",
  name: "Test User",
  password: "password123",
};

// This should fail at compile time if types don't match
const user: User = {
  id: "1",
  email: createDTO.email,
  name: createDTO.name,
  role: "member",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

expectType<User>(user);
```

### Validation Schema Tests

```typescript
describe("UserSchema", () => {
  it("should validate correct user data", () => {
    const result = CreateUserSchema.safeParse({
      email: "test@example.com",
      name: "Test User",
      password: "password123",
    });
    
    expect(result.success).toBe(true);
  });
  
  it("should reject invalid email", () => {
    const result = CreateUserSchema.safeParse({
      email: "invalid-email",
      name: "Test User",
      password: "password123",
    });
    
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain("email");
  });
  
  it("should reject short password", () => {
    const result = CreateUserSchema.safeParse({
      email: "test@example.com",
      name: "Test User",
      password: "short",
    });
    
    expect(result.success).toBe(false);
  });
});
```

### Value Object Tests

```typescript
describe("Email", () => {
  it("should create valid email", () => {
    const email = Email.create("test@example.com");
    expect(email.value).toBe("test@example.com");
  });
  
  it("should normalize to lowercase", () => {
    const email = Email.create("TEST@EXAMPLE.COM");
    expect(email.value).toBe("test@example.com");
  });
  
  it("should throw for invalid email", () => {
    expect(() => Email.create("invalid")).toThrow(InvalidEmailError);
  });
  
  it("should compare emails correctly", () => {
    const email1 = Email.create("test@example.com");
    const email2 = Email.create("TEST@example.com");
    expect(email1.equals(email2)).toBe(true);
  });
});
```

