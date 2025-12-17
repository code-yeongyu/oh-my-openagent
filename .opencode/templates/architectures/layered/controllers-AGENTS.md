# Controller Layer Instructions

## Purpose

This directory contains HTTP handlers. Controllers translate HTTP requests to service calls and service results to HTTP responses.

## Responsibilities

- Parse and validate incoming HTTP requests
- Transform requests into DTOs for services
- Call appropriate service methods
- Transform service results into HTTP responses
- Map service errors to HTTP status codes
- Handle authentication and authorization checks

## Rules

### 1. Thin Controllers
Minimal logic in controllers. Delegate business logic to services.

```typescript
// ✅ GOOD: Thin controller, delegates to service
@Post("/users")
async createUser(req: Request, res: Response): Promise<void> {
  const data = validateCreateUserRequest(req.body);
  const user = await this.userService.registerUser(data);
  res.status(201).json(toUserResponse(user));
}

// ❌ BAD: Business logic in controller
@Post("/users")
async createUser(req: Request, res: Response): Promise<void> {
  const existingUser = await this.db.users.findByEmail(req.body.email);
  if (existingUser) {
    return res.status(409).json({ error: "Email exists" });
  }
  const hashedPassword = await bcrypt.hash(req.body.password, 10);
  const user = await this.db.users.create({
    ...req.body,
    password: hashedPassword,
  });
  await this.emailService.sendWelcome(user);
  res.status(201).json(user);
}
```

### 2. HTTP Translation Only
Controllers convert HTTP → DTO and result → HTTP response. Nothing else.

```typescript
// ✅ GOOD: Pure translation
@Get("/users/:id")
async getUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const user = await this.userService.getUser(id);
  res.json(toUserResponse(user));
}
```

### 3. Input Validation
Validate and sanitize all inputs at the controller boundary.

```typescript
// ✅ GOOD: Validate at boundary
@Post("/users")
async createUser(req: Request, res: Response): Promise<void> {
  // Validate input structure and types
  const result = CreateUserSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ errors: result.error.flatten() });
  }
  
  const user = await this.userService.registerUser(result.data);
  res.status(201).json(toUserResponse(user));
}
```

### 4. Error Mapping
Convert service errors to appropriate HTTP responses.

```typescript
// ✅ GOOD: Centralized error mapping
@Post("/users")
async createUser(req: Request, res: Response): Promise<void> {
  try {
    const data = validateRequest(req.body);
    const user = await this.userService.registerUser(data);
    res.status(201).json(toUserResponse(user));
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      return res.status(409).json({ error: "Email already registered" });
    }
    if (error instanceof ValidationError) {
      return res.status(400).json({ errors: error.details });
    }
    throw error; // Let error middleware handle unexpected errors
  }
}
```

### 5. Auth Enforcement
Check authentication and authorization in controllers or middleware.

```typescript
// ✅ GOOD: Auth checks at controller level
@Delete("/users/:id")
@Authenticated()
@RequireRole("admin")
async deleteUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  await this.userService.deleteUser(id);
  res.status(204).send();
}
```

## Patterns

### RESTful Controller Structure

```typescript
@Controller("/users")
class UserController {
  constructor(private userService: UserService) {}
  
  // GET /users
  @Get("/")
  async list(req: Request, res: Response): Promise<void> {
    const filters = parseUserFilters(req.query);
    const users = await this.userService.listUsers(filters);
    res.json({ data: users.map(toUserResponse) });
  }
  
  // GET /users/:id
  @Get("/:id")
  async get(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const user = await this.userService.getUser(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ data: toUserResponse(user) });
  }
  
  // POST /users
  @Post("/")
  async create(req: Request, res: Response): Promise<void> {
    const data = validateCreateRequest(req.body);
    const user = await this.userService.registerUser(data);
    res.status(201).json({ data: toUserResponse(user) });
  }
  
  // PUT /users/:id
  @Put("/:id")
  async update(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const data = validateUpdateRequest(req.body);
    const user = await this.userService.updateUser(id, data);
    res.json({ data: toUserResponse(user) });
  }
  
  // DELETE /users/:id
  @Delete("/:id")
  async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    await this.userService.deleteUser(id);
    res.status(204).send();
  }
}
```

### Response DTOs

```typescript
// response-dtos.ts
interface UserResponse {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  // Note: Never include sensitive fields like password
}

function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

### Request Validation with Zod

```typescript
import { z } from "zod";

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8),
});

type CreateUserRequest = z.infer<typeof CreateUserSchema>;

function validateCreateRequest(body: unknown): CreateUserRequest {
  return CreateUserSchema.parse(body);
}
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| File | `{resource}-controller.ts` | `user-controller.ts` |
| Class | `{Resource}Controller` | `UserController` |
| Routes | RESTful | `GET /users`, `POST /users` |
| Handlers | `{action}` | `list`, `get`, `create`, `update`, `delete` |

## Dependencies

### MAY Import
- Services (`../services/`)
- Request/Response types
- Validation schemas
- Response DTOs
- Authentication decorators/middleware

### MUST NOT Import
- Repositories (`../repositories/`)
- Database types or clients
- Internal domain logic

## Error Handling

### Global Error Middleware

```typescript
// middleware/error-handler.ts
function errorHandler(error: Error, req: Request, res: Response, next: NextFunction): void {
  // Log error for debugging
  console.error(error);
  
  // Map known errors to HTTP responses
  if (error instanceof BusinessError) {
    return res.status(mapBusinessErrorToStatus(error)).json({
      error: error.message,
      code: error.code,
    });
  }
  
  if (error instanceof ValidationError) {
    return res.status(400).json({
      error: "Validation failed",
      details: error.details,
    });
  }
  
  if (error instanceof NotFoundError) {
    return res.status(404).json({
      error: error.message,
    });
  }
  
  // Unknown errors
  res.status(500).json({
    error: "Internal server error",
  });
}

function mapBusinessErrorToStatus(error: BusinessError): number {
  const statusMap: Record<string, number> = {
    DUPLICATE_EMAIL: 409,
    INSUFFICIENT_FUNDS: 402,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
  };
  return statusMap[error.code] || 400;
}
```

## Testing

### Unit Tests
- Mock service dependencies
- Test HTTP status codes
- Test request validation
- Test response format
- Test error handling

```typescript
describe("UserController", () => {
  let controller: UserController;
  let mockUserService: MockUserService;
  let mockReq: MockRequest;
  let mockRes: MockResponse;
  
  beforeEach(() => {
    mockUserService = createMockUserService();
    controller = new UserController(mockUserService);
    mockReq = createMockRequest();
    mockRes = createMockResponse();
  });
  
  describe("POST /users", () => {
    it("should return 201 for valid request", async () => {
      mockReq.body = { email: "test@example.com", name: "Test", password: "password123" };
      mockUserService.registerUser.mockResolvedValue(newUser);
      
      await controller.create(mockReq, mockRes);
      
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: "test@example.com" }),
      });
    });
    
    it("should return 400 for invalid email", async () => {
      mockReq.body = { email: "invalid", name: "Test", password: "password123" };
      
      await controller.create(mockReq, mockRes);
      
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
    
    it("should return 409 for duplicate email", async () => {
      mockReq.body = validUserData;
      mockUserService.registerUser.mockRejectedValue(new DuplicateEmailError());
      
      await controller.create(mockReq, mockRes);
      
      expect(mockRes.status).toHaveBeenCalledWith(409);
    });
  });
});
```

### Integration Tests
- Test actual HTTP endpoints
- Test authentication flow
- Test complete request/response cycle
- Use test fixtures and factories

