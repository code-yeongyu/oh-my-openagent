# Repository Layer Instructions

## Purpose

This directory contains data access logic. Repositories handle all database interactions, providing a clean abstraction over the persistence layer.

## Responsibilities

- Execute database queries (CRUD operations)
- Transform database results to domain models
- Handle database-specific error cases
- Manage connection pooling and transactions (when needed)
- Implement query optimization and caching strategies

## Rules

### 1. Single Responsibility
Each repository handles **ONE entity/table**. If you need to work with multiple entities, inject multiple repositories.

```typescript
// ✅ GOOD: Single entity focus
class UserRepository {
  async findById(id: string): Promise<User | null> { }
}

// ❌ BAD: Multiple entity responsibilities
class DataRepository {
  async findUser(id: string): Promise<User> { }
  async findOrder(id: string): Promise<Order> { }
}
```

### 2. No Business Logic
Repositories only perform data operations. Business rules belong in services.

```typescript
// ✅ GOOD: Pure data access
async findActiveUsers(): Promise<User[]> {
  return this.db.users.findMany({ where: { status: "active" } });
}

// ❌ BAD: Business logic in repository
async findActiveUsers(): Promise<User[]> {
  const users = await this.db.users.findMany();
  return users.filter(u => u.status === "active" && u.lastLogin > thirtyDaysAgo);
}
```

### 3. Return Domain Objects
Transform database results to domain models. Never expose raw database entities.

```typescript
// ✅ GOOD: Returns domain model
async findById(id: string): Promise<User | null> {
  const record = await this.db.users.findUnique({ where: { id } });
  return record ? this.toDomain(record) : null;
}
```

### 4. No HTTP Awareness
Never import request/response types or HTTP-related code.

### 5. Use Parameterized Queries
Always use parameterized queries to prevent SQL injection.

```typescript
// ✅ GOOD: Parameterized query
await this.db.query("SELECT * FROM users WHERE id = $1", [id]);

// ❌ BAD: String interpolation
await this.db.query(`SELECT * FROM users WHERE id = '${id}'`);
```

## Patterns

### Repository Interface

```typescript
interface Repository<T, CreateDTO, UpdateDTO> {
  findById(id: string): Promise<T | null>;
  findAll(filters?: FilterOptions): Promise<T[]>;
  create(data: CreateDTO): Promise<T>;
  update(id: string, data: UpdateDTO): Promise<T>;
  delete(id: string): Promise<boolean>;
}

class UserRepository implements Repository<User, CreateUserDTO, UpdateUserDTO> {
  constructor(private db: Database) {}
  
  async findById(id: string): Promise<User | null> {
    const record = await this.db.users.findUnique({ where: { id } });
    return record ? this.toDomain(record) : null;
  }
  
  async findAll(filters?: UserFilters): Promise<User[]> {
    const records = await this.db.users.findMany({ where: filters });
    return records.map(this.toDomain);
  }
  
  async create(data: CreateUserDTO): Promise<User> {
    const record = await this.db.users.create({ data });
    return this.toDomain(record);
  }
  
  async update(id: string, data: UpdateUserDTO): Promise<User> {
    const record = await this.db.users.update({ where: { id }, data });
    return this.toDomain(record);
  }
  
  async delete(id: string): Promise<boolean> {
    await this.db.users.delete({ where: { id } });
    return true;
  }
  
  private toDomain(record: DbUser): User {
    return new User({
      id: record.id,
      email: record.email,
      name: record.name,
      createdAt: record.created_at,
    });
  }
}
```

### Custom Query Methods

```typescript
class UserRepository {
  // Specific query methods for common access patterns
  async findByEmail(email: string): Promise<User | null> { }
  async findByTeam(teamId: string): Promise<User[]> { }
  async findWithRecentActivity(since: Date): Promise<User[]> { }
}
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| File | `{entity}-repository.ts` | `user-repository.ts` |
| Class | `{Entity}Repository` | `UserRepository` |
| Find Methods | `find*`, `get*` | `findById`, `findByEmail` |
| Create Methods | `create`, `insert` | `create`, `createMany` |
| Update Methods | `update`, `save` | `update`, `updateMany` |
| Delete Methods | `delete`, `remove` | `delete`, `softDelete` |

## Dependencies

### MAY Import
- Models and DTOs (`../models/`)
- Database clients and ORMs
- Utility functions for data transformation
- Error types specific to data access

### MUST NOT Import
- Services (`../services/`)
- Controllers (`../controllers/`)
- HTTP types (Request, Response, etc.)
- Framework-specific routing code

## Error Handling

```typescript
class UserRepository {
  async findById(id: string): Promise<User | null> {
    try {
      const record = await this.db.users.findUnique({ where: { id } });
      return record ? this.toDomain(record) : null;
    } catch (error) {
      if (error instanceof DatabaseConnectionError) {
        throw new RepositoryError("Database connection failed", error);
      }
      throw error;
    }
  }
}
```

## Testing

### Unit Tests
- Mock the database client
- Test each CRUD operation
- Test error cases (not found, constraints, connection errors)
- Test data transformation logic

```typescript
describe("UserRepository", () => {
  let repository: UserRepository;
  let mockDb: MockDatabase;
  
  beforeEach(() => {
    mockDb = createMockDatabase();
    repository = new UserRepository(mockDb);
  });
  
  it("should return null for non-existent user", async () => {
    mockDb.users.findUnique.mockResolvedValue(null);
    const result = await repository.findById("non-existent");
    expect(result).toBeNull();
  });
  
  it("should transform database record to domain model", async () => {
    mockDb.users.findUnique.mockResolvedValue({
      id: "1",
      email: "test@example.com",
      name: "Test User",
      created_at: new Date(),
    });
    
    const result = await repository.findById("1");
    expect(result).toBeInstanceOf(User);
    expect(result?.email).toBe("test@example.com");
  });
});
```

### Integration Tests
- Use test database or in-memory database
- Test actual query execution
- Test constraint violations
- Clean up test data after each test

