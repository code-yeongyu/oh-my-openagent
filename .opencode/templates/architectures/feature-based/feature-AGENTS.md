# Feature: {{feature_name}}

> This is a template for individual feature modules. Replace `{{feature_name}}` with the actual feature name.

## Purpose

Self-contained feature module for {{feature_description}}.

This feature owns all code related to its business capability, including UI components, business logic, data access, and tests.

## Structure

```
features/{{feature_name}}/
├── components/          # UI components (frontend features)
│   ├── {{Feature}}List.tsx
│   ├── {{Feature}}Form.tsx
│   └── {{Feature}}Card.tsx
├── hooks/               # Custom hooks (frontend features)
│   ├── use{{Feature}}.ts
│   └── use{{Feature}}List.ts
├── api/                 # API routes/handlers
│   ├── routes.ts
│   └── handlers.ts
├── services/            # Business logic
│   ├── {{feature}}-service.ts
│   └── {{feature}}-validator.ts
├── repositories/        # Data access
│   └── {{feature}}-repository.ts
├── models/              # Types and DTOs
│   ├── {{feature}}.ts
│   └── {{feature}}-dto.ts
├── utils/               # Feature utilities
│   └── {{feature}}-utils.ts
├── tests/               # Feature tests
│   ├── {{feature}}-service.test.ts
│   └── {{feature}}.e2e.test.ts
└── index.ts             # Public API
```

## Rules

### 1. Self-Contained
The feature should work independently. All code needed for the feature lives here.

```typescript
// ✅ GOOD: Feature contains everything it needs
// features/orders/
//   ├── services/order-service.ts
//   ├── repositories/order-repository.ts
//   └── models/order.ts

// ❌ BAD: Feature depends on another feature's internals
import { ProductService } from "../products/services/product-service";
```

### 2. Minimal External Dependencies
Only import from `shared/` and `infrastructure/`. Never import from other features.

```typescript
// ✅ GOOD: Import from shared
import { Button, Modal } from "@/shared/components";
import { formatCurrency } from "@/shared/utils";
import { useAuth } from "@/shared/hooks";

// ✅ GOOD: Import from infrastructure
import { db } from "@/infrastructure/database";
import { apiClient } from "@/infrastructure/api";

// ❌ BAD: Import from another feature
import { ProductCard } from "@/features/products/components";
import { useProduct } from "@/features/products/hooks";
```

### 3. Co-located Tests
Tests live with the feature code, not in a separate test directory.

```typescript
// ✅ GOOD: Tests in feature directory
// features/orders/tests/order-service.test.ts
// features/orders/tests/order.e2e.test.ts

// ❌ BAD: Tests in separate root directory
// __tests__/features/orders/order-service.test.ts
```

### 4. Single Export Point
Use the index file to define the public API. Only export what other parts of the app need.

```typescript
// features/orders/index.ts
// ✅ GOOD: Explicit public API
export { OrderList } from "./components/OrderList";
export { OrderDetail } from "./components/OrderDetail";
export { useOrders } from "./hooks/useOrders";
export type { Order, OrderStatus } from "./models/order";

// Internal implementation details are NOT exported
// OrderService, OrderRepository, etc. stay internal
```

### 5. Cross-Feature Communication
Use events or shared services instead of direct imports.

```typescript
// ✅ GOOD: Event-based communication
import { eventBus } from "@/shared/events";

// In orders feature
class OrderService {
  async completeOrder(orderId: string): Promise<void> {
    await this.orderRepository.updateStatus(orderId, "completed");
    
    // Notify other features via event
    eventBus.emit("order:completed", { orderId });
  }
}

// In notifications feature
eventBus.on("order:completed", async ({ orderId }) => {
  await notificationService.sendOrderCompletedEmail(orderId);
});
```

## Patterns

### Feature Service

```typescript
// features/orders/services/order-service.ts
import { db } from "@/infrastructure/database";
import { eventBus } from "@/shared/events";
import { OrderRepository } from "../repositories/order-repository";
import { Order, CreateOrderDTO, OrderStatus } from "../models/order";

export class OrderService {
  private repository: OrderRepository;
  
  constructor() {
    this.repository = new OrderRepository(db);
  }
  
  async createOrder(data: CreateOrderDTO): Promise<Order> {
    // Validate
    this.validateOrder(data);
    
    // Create
    const order = await this.repository.create(data);
    
    // Emit event for other features
    eventBus.emit("order:created", { order });
    
    return order;
  }
  
  async getOrder(id: string): Promise<Order | null> {
    return this.repository.findById(id);
  }
  
  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    const order = await this.repository.updateStatus(id, status);
    
    eventBus.emit("order:status-changed", { order, status });
    
    return order;
  }
  
  private validateOrder(data: CreateOrderDTO): void {
    if (!data.items || data.items.length === 0) {
      throw new ValidationError("Order must have at least one item");
    }
  }
}
```

### Feature Repository

```typescript
// features/orders/repositories/order-repository.ts
import { Database } from "@/infrastructure/database";
import { Order, CreateOrderDTO, OrderStatus } from "../models/order";

export class OrderRepository {
  constructor(private db: Database) {}
  
  async findById(id: string): Promise<Order | null> {
    return this.db.orders.findUnique({
      where: { id },
      include: { items: true },
    });
  }
  
  async findByCustomerId(customerId: string): Promise<Order[]> {
    return this.db.orders.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });
  }
  
  async create(data: CreateOrderDTO): Promise<Order> {
    return this.db.orders.create({
      data: {
        customerId: data.customerId,
        items: { create: data.items },
        status: "pending",
      },
      include: { items: true },
    });
  }
  
  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    return this.db.orders.update({
      where: { id },
      data: { status },
      include: { items: true },
    });
  }
}
```

### Feature Components (Frontend)

```typescript
// features/orders/components/OrderList.tsx
import { useOrders } from "../hooks/useOrders";
import { OrderCard } from "./OrderCard";
import { LoadingSpinner, ErrorMessage } from "@/shared/components";

export function OrderList() {
  const { orders, isLoading, error } = useOrders();
  
  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error.message} />;
  
  return (
    <div className="order-list">
      {orders.map(order => (
        <OrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}
```

### Feature Hooks (Frontend)

```typescript
// features/orders/hooks/useOrders.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orderApi } from "../api/order-api";
import { Order, CreateOrderDTO } from "../models/order";

export function useOrders(customerId?: string) {
  return useQuery({
    queryKey: ["orders", customerId],
    queryFn: () => orderApi.getOrders(customerId),
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ["orders", id],
    queryFn: () => orderApi.getOrder(id),
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateOrderDTO) => orderApi.createOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
```

### Feature API Routes

```typescript
// features/orders/api/routes.ts
import { Router } from "express";
import { OrderService } from "../services/order-service";
import { authenticate } from "@/shared/middleware";

export function createOrderRoutes(): Router {
  const router = Router();
  const service = new OrderService();
  
  router.get("/orders", authenticate, async (req, res) => {
    const orders = await service.getOrders(req.user.id);
    res.json({ data: orders });
  });
  
  router.get("/orders/:id", authenticate, async (req, res) => {
    const order = await service.getOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json({ data: order });
  });
  
  router.post("/orders", authenticate, async (req, res) => {
    const order = await service.createOrder({
      ...req.body,
      customerId: req.user.id,
    });
    res.status(201).json({ data: order });
  });
  
  return router;
}
```

### Feature Public API (index.ts)

```typescript
// features/orders/index.ts

// Components (for frontend features)
export { OrderList } from "./components/OrderList";
export { OrderDetail } from "./components/OrderDetail";
export { OrderForm } from "./components/OrderForm";

// Hooks (for frontend features)
export { useOrders, useOrder, useCreateOrder } from "./hooks/useOrders";

// API Routes (for backend features)
export { createOrderRoutes } from "./api/routes";

// Types (shared across app)
export type { Order, OrderItem, OrderStatus, CreateOrderDTO } from "./models/order";

// Note: Internal implementation (services, repositories) is NOT exported
```

## Dependencies

### MAY Import
- `@/shared/*` - Shared utilities, components, types
- `@/infrastructure/*` - Database, API clients, config

### MUST NOT Import
- `@/features/*` - Other features (use events instead)

## Testing

### Unit Tests

```typescript
// features/orders/tests/order-service.test.ts
import { OrderService } from "../services/order-service";
import { mockOrderRepository } from "./mocks";

describe("OrderService", () => {
  let service: OrderService;
  
  beforeEach(() => {
    service = new OrderService(mockOrderRepository);
  });
  
  describe("createOrder", () => {
    it("should create order with valid data", async () => {
      const data = { customerId: "123", items: [{ productId: "p1", quantity: 2 }] };
      
      const order = await service.createOrder(data);
      
      expect(order.id).toBeDefined();
      expect(order.status).toBe("pending");
    });
    
    it("should throw for empty items", async () => {
      const data = { customerId: "123", items: [] };
      
      await expect(service.createOrder(data)).rejects.toThrow(ValidationError);
    });
  });
});
```

### Integration Tests

```typescript
// features/orders/tests/order.e2e.test.ts
import request from "supertest";
import { app } from "@/infrastructure/app";
import { setupTestDatabase, cleanupTestDatabase } from "@/shared/testing";

describe("Orders API", () => {
  beforeAll(() => setupTestDatabase());
  afterAll(() => cleanupTestDatabase());
  
  it("should create and retrieve order", async () => {
    // Create order
    const createResponse = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        items: [{ productId: "p1", quantity: 1 }],
      });
    
    expect(createResponse.status).toBe(201);
    
    // Retrieve order
    const getResponse = await request(app)
      .get(`/api/orders/${createResponse.body.data.id}`)
      .set("Authorization", `Bearer ${testToken}`);
    
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.status).toBe("pending");
  });
});
```

