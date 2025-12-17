# Service Layer Instructions

## Purpose

This directory contains business logic. Services orchestrate operations, enforce business rules, and coordinate between repositories and external integrations.

## Responsibilities

- Implement business rules and domain logic
- Orchestrate multi-repository operations
- Define transaction boundaries
- Coordinate external service calls
- Handle business-level error cases
- Validate business invariants

## Rules

### 1. Business Logic Home
All business rules live here. Never put business logic in controllers or repositories.

```typescript
// ✅ GOOD: Business rules in service
class OrderService {
  async createOrder(userId: string, items: OrderItem[]): Promise<Order> {
    // Business rule: validate minimum order amount
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if (total < MIN_ORDER_AMOUNT) {
      throw new BusinessError("Order must be at least $10");
    }
    
    // Business rule: check inventory
    await this.validateInventory(items);
    
    // Business rule: apply discounts
    const discount = await this.calculateDiscount(userId, items);
    
    return this.orderRepository.create({ userId, items, discount });
  }
}
```

### 2. Repository Consumers
Services use repositories for data access. Never use raw database connections.

```typescript
// ✅ GOOD: Uses repository
class UserService {
  constructor(private userRepository: UserRepository) {}
  
  async getUser(id: string): Promise<User> {
    return this.userRepository.findById(id);
  }
}

// ❌ BAD: Direct database access
class UserService {
  constructor(private db: Database) {}
  
  async getUser(id: string): Promise<User> {
    return this.db.query("SELECT * FROM users WHERE id = ?", [id]);
  }
}
```

### 3. Transaction Boundaries
Services define transaction scope for operations that need atomicity.

```typescript
class TransferService {
  async transferFunds(from: string, to: string, amount: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.accountRepository.debit(from, amount, tx);
      await this.accountRepository.credit(to, amount, tx);
      await this.auditRepository.log({ from, to, amount }, tx);
    });
  }
}
```

### 4. No HTTP Awareness
Never import request/response types or HTTP status codes.

```typescript
// ✅ GOOD: Throws business error
async validateUser(data: CreateUserDTO): Promise<void> {
  if (await this.userRepository.findByEmail(data.email)) {
    throw new DuplicateEmailError("Email already registered");
  }
}

// ❌ BAD: HTTP-aware
async validateUser(data: CreateUserDTO): Promise<{ status: number; message: string }> {
  if (await this.userRepository.findByEmail(data.email)) {
    return { status: 409, message: "Email already registered" };
  }
}
```

### 5. Dependency Injection
Accept repositories and other dependencies via constructor for testability.

```typescript
class UserService {
  constructor(
    private userRepository: UserRepository,
    private emailService: EmailService,
    private eventEmitter: EventEmitter,
  ) {}
}
```

## Patterns

### Service Structure

```typescript
class UserService {
  constructor(
    private userRepository: UserRepository,
    private teamRepository: TeamRepository,
    private emailService: EmailService,
  ) {}
  
  async registerUser(data: RegisterDTO): Promise<User> {
    // 1. Validate business rules
    await this.validateRegistration(data);
    
    // 2. Perform main operation
    const user = await this.userRepository.create({
      email: data.email,
      name: data.name,
      passwordHash: await this.hashPassword(data.password),
    });
    
    // 3. Handle side effects
    await this.emailService.sendWelcomeEmail(user);
    
    return user;
  }
  
  private async validateRegistration(data: RegisterDTO): Promise<void> {
    // Check for duplicate email
    const existing = await this.userRepository.findByEmail(data.email);
    if (existing) {
      throw new DuplicateEmailError();
    }
    
    // Validate password strength
    if (!this.isStrongPassword(data.password)) {
      throw new WeakPasswordError();
    }
  }
}
```

### Service Composition

```typescript
// Higher-level services can compose lower-level services
class OnboardingService {
  constructor(
    private userService: UserService,
    private teamService: TeamService,
    private notificationService: NotificationService,
  ) {}
  
  async onboardNewUser(data: OnboardingDTO): Promise<OnboardingResult> {
    const user = await this.userService.registerUser(data.user);
    const team = await this.teamService.createTeam(user.id, data.team);
    await this.notificationService.notifyTeamCreated(team);
    
    return { user, team };
  }
}
```

### Event-Driven Side Effects

```typescript
class UserService {
  constructor(
    private userRepository: UserRepository,
    private eventEmitter: EventEmitter,
  ) {}
  
  async registerUser(data: RegisterDTO): Promise<User> {
    const user = await this.userRepository.create(data);
    
    // Emit event for decoupled side effects
    this.eventEmitter.emit("user.registered", { user });
    
    return user;
  }
}

// Separate listener handles side effects
class WelcomeEmailListener {
  constructor(private emailService: EmailService) {}
  
  @OnEvent("user.registered")
  async handle(event: UserRegisteredEvent): Promise<void> {
    await this.emailService.sendWelcomeEmail(event.user);
  }
}
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| File | `{domain}-service.ts` | `user-service.ts` |
| Class | `{Domain}Service` | `UserService` |
| Methods | Action verbs | `registerUser`, `processOrder` |
| Validators | `validate*` | `validateRegistration` |
| Private Helpers | `_` prefix or no prefix | `_hashPassword`, `hashPassword` |

## Dependencies

### MAY Import
- Repositories (`../repositories/`)
- Domain models (`../models/`)
- Other services (for composition)
- External service clients
- Event emitters
- Utility functions

### MUST NOT Import
- Controllers (`../controllers/`)
- HTTP types (Request, Response, etc.)
- Framework-specific routing/middleware code

## Error Handling

Define business-specific error types:

```typescript
// errors/business-errors.ts
export class BusinessError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "BusinessError";
  }
}

export class DuplicateEmailError extends BusinessError {
  constructor() {
    super("Email already registered", "DUPLICATE_EMAIL");
  }
}

export class InsufficientFundsError extends BusinessError {
  constructor(available: number, required: number) {
    super(
      `Insufficient funds: ${available} available, ${required} required`,
      "INSUFFICIENT_FUNDS",
    );
  }
}
```

## Testing

### Unit Tests
- Mock all repository dependencies
- Test business rule enforcement
- Test error handling
- Test side effect triggers

```typescript
describe("UserService", () => {
  let service: UserService;
  let mockUserRepository: MockUserRepository;
  let mockEmailService: MockEmailService;
  
  beforeEach(() => {
    mockUserRepository = createMockUserRepository();
    mockEmailService = createMockEmailService();
    service = new UserService(mockUserRepository, mockEmailService);
  });
  
  describe("registerUser", () => {
    it("should throw DuplicateEmailError for existing email", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(existingUser);
      
      await expect(service.registerUser(validData))
        .rejects.toThrow(DuplicateEmailError);
    });
    
    it("should send welcome email after registration", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue(newUser);
      
      await service.registerUser(validData);
      
      expect(mockEmailService.sendWelcomeEmail).toHaveBeenCalledWith(newUser);
    });
  });
});
```

### Integration Tests
- Test with real repositories (test database)
- Test transaction behavior
- Test service composition
- Verify side effects

