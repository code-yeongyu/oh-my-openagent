# Ports Layer Instructions

## Purpose

This directory contains interface definitions that define how the application interacts with the outside world. Ports are the contracts between the application core and external systems.

## Responsibilities

- Define inbound ports (use cases) - how external actors interact with the application
- Define outbound ports (driven) - what the application needs from external systems
- Provide clear contracts that adapters must implement
- Ensure technology-agnostic interface definitions

## Types of Ports

### Inbound Ports (Primary/Driving)
Interfaces that define what the application CAN DO. These are implemented by application services and called by primary adapters (HTTP handlers, CLI, etc.).

```typescript
// ports/inbound/order-use-cases.ts
export interface CreateOrderUseCase {
  execute(command: CreateOrderCommand): Promise<OrderId>;
}

export interface GetOrderUseCase {
  execute(query: GetOrderQuery): Promise<OrderDTO | null>;
}

export interface SubmitOrderUseCase {
  execute(command: SubmitOrderCommand): Promise<void>;
}
```

### Outbound Ports (Secondary/Driven)
Interfaces that define what the application NEEDS. These are implemented by secondary adapters (database, external APIs, etc.).

```typescript
// ports/outbound/order-repository.ts
export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  findByCustomerId(customerId: CustomerId): Promise<Order[]>;
  save(order: Order): Promise<void>;
  delete(id: OrderId): Promise<void>;
}

// ports/outbound/payment-gateway.ts
export interface PaymentGateway {
  charge(payment: Payment): Promise<PaymentResult>;
  refund(paymentId: PaymentId): Promise<RefundResult>;
}
```

## Rules

### 1. Pure Interfaces
Ports are interfaces only - no implementations, no logic.

```typescript
// ✅ GOOD: Pure interface
export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  save(order: Order): Promise<void>;
}

// ❌ BAD: Abstract class with logic
export abstract class OrderRepository {
  abstract findById(id: OrderId): Promise<Order | null>;
  
  async findOrFail(id: OrderId): Promise<Order> {
    const order = await this.findById(id);
    if (!order) throw new OrderNotFoundError(id);
    return order;
  }
}
```

### 2. Domain Types Only
Ports use domain types, not infrastructure types.

```typescript
// ✅ GOOD: Uses domain types
export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  save(order: Order): Promise<void>;
}

// ❌ BAD: Uses infrastructure types
export interface OrderRepository {
  findById(id: string): Promise<PrismaOrder | null>;
  save(order: OrderRecord): Promise<void>;
}
```

### 3. Technology Agnostic
No framework or technology references in port definitions.

```typescript
// ✅ GOOD: Technology agnostic
export interface EmailSender {
  send(email: Email): Promise<void>;
}

// ❌ BAD: Technology specific
export interface SendGridEmailSender {
  send(message: SendGridMessage): Promise<void>;
}
```

### 4. Command/Query Separation
Separate read operations from write operations when possible.

```typescript
// Commands (write operations)
export interface CreateOrderUseCase {
  execute(command: CreateOrderCommand): Promise<OrderId>;
}

export interface SubmitOrderUseCase {
  execute(command: SubmitOrderCommand): Promise<void>;
}

// Queries (read operations)
export interface GetOrderQuery {
  execute(query: GetOrderQueryParams): Promise<OrderDTO | null>;
}

export interface ListOrdersQuery {
  execute(query: ListOrdersQueryParams): Promise<OrderDTO[]>;
}
```

## Patterns

### Inbound Port (Use Case)

```typescript
// ports/inbound/create-order.ts
export interface CreateOrderCommand {
  customerId: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
}

export interface CreateOrderUseCase {
  execute(command: CreateOrderCommand): Promise<OrderId>;
}
```

### Outbound Port (Repository)

```typescript
// ports/outbound/repositories/order-repository.ts
export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  findByCustomerId(customerId: CustomerId): Promise<Order[]>;
  findByStatus(status: OrderStatus): Promise<Order[]>;
  save(order: Order): Promise<void>;
  delete(id: OrderId): Promise<void>;
  nextId(): OrderId;
}
```

### Outbound Port (External Service)

```typescript
// ports/outbound/services/notification-service.ts
export interface NotificationService {
  sendOrderConfirmation(order: Order, customer: Customer): Promise<void>;
  sendShippingUpdate(order: Order, tracking: TrackingInfo): Promise<void>;
}

// ports/outbound/services/inventory-checker.ts
export interface InventoryChecker {
  checkAvailability(productId: ProductId, quantity: number): Promise<AvailabilityResult>;
  reserve(productId: ProductId, quantity: number): Promise<ReservationId>;
  release(reservationId: ReservationId): Promise<void>;
}
```

### Query DTOs

```typescript
// ports/inbound/queries/order-queries.ts
export interface GetOrderQueryParams {
  orderId: string;
}

export interface ListOrdersQueryParams {
  customerId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

// Response DTOs (read models)
export interface OrderDTO {
  id: string;
  customerId: string;
  status: string;
  total: {
    amount: number;
    currency: string;
  };
  items: OrderItemDTO[];
  createdAt: string;
}

export interface OrderItemDTO {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}
```

## File Organization

```
ports/
├── inbound/
│   ├── commands/
│   │   ├── create-order.ts
│   │   ├── submit-order.ts
│   │   └── cancel-order.ts
│   ├── queries/
│   │   ├── get-order.ts
│   │   └── list-orders.ts
│   └── index.ts
├── outbound/
│   ├── repositories/
│   │   ├── order-repository.ts
│   │   ├── customer-repository.ts
│   │   └── product-repository.ts
│   ├── services/
│   │   ├── payment-gateway.ts
│   │   ├── notification-service.ts
│   │   └── inventory-checker.ts
│   └── index.ts
└── index.ts
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Inbound Port Files | `{action}.ts` | `create-order.ts` |
| Outbound Port Files | `{entity}-repository.ts` | `order-repository.ts` |
| Command Interfaces | `{Action}{Entity}Command` | `CreateOrderCommand` |
| Use Case Interfaces | `{Action}{Entity}UseCase` | `CreateOrderUseCase` |
| Query Interfaces | `{Action}{Entity}Query` | `GetOrderQuery` |
| Repository Interfaces | `{Entity}Repository` | `OrderRepository` |
| Service Interfaces | `{Domain}Service` | `NotificationService` |

## Dependencies

### MAY Import
- Domain types (`../domain/`)

### MUST NOT Import
- Adapters (`../adapters/`)
- Application (`../application/`)
- Any framework or infrastructure code

## Testing

Ports don't have implementations to test, but you can verify:

### Type Compliance Tests

```typescript
// Verify adapter implements port correctly
import { OrderRepository } from "@/ports/outbound/order-repository";
import { PrismaOrderRepository } from "@/adapters/database/prisma-order-repository";

describe("PrismaOrderRepository", () => {
  it("should implement OrderRepository interface", () => {
    const repo: OrderRepository = new PrismaOrderRepository(prismaClient);
    
    // TypeScript will catch if implementation doesn't match interface
    expect(repo.findById).toBeDefined();
    expect(repo.save).toBeDefined();
    expect(repo.delete).toBeDefined();
  });
});
```

### Mock Generation

```typescript
// Use ports to generate test mocks
function createMockOrderRepository(): jest.Mocked<OrderRepository> {
  return {
    findById: jest.fn(),
    findByCustomerId: jest.fn(),
    findByStatus: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    nextId: jest.fn(),
  };
}
```

