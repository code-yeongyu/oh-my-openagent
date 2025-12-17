# Adapters Layer Instructions

## Purpose

This directory contains implementations that connect the application to the outside world. Adapters implement ports, bridging the gap between abstract interfaces and concrete technologies.

## Responsibilities

- Implement outbound ports (repositories, external services)
- Create inbound adapters (HTTP handlers, CLI commands)
- Handle technology-specific concerns (serialization, connection pooling)
- Transform between domain types and infrastructure types
- Manage infrastructure configuration

## Types of Adapters

### Primary (Driving) Adapters
Drive the application by calling inbound ports. Examples:
- HTTP/REST controllers
- GraphQL resolvers
- CLI commands
- Message queue consumers
- Scheduled job handlers

### Secondary (Driven) Adapters
Implement outbound ports, driven by the application. Examples:
- Database repositories
- External API clients
- Email senders
- Message publishers
- File storage

## Rules

### 1. Implement Ports
Every adapter must implement a port interface.

```typescript
// ✅ GOOD: Implements port interface
export class PrismaOrderRepository implements OrderRepository {
  constructor(private prisma: PrismaClient) {}
  
  async findById(id: OrderId): Promise<Order | null> {
    const record = await this.prisma.order.findUnique({
      where: { id: id.value },
      include: { items: true },
    });
    return record ? this.toDomain(record) : null;
  }
  
  async save(order: Order): Promise<void> {
    await this.prisma.order.upsert({
      where: { id: order.id.value },
      create: this.toPersistence(order),
      update: this.toPersistence(order),
    });
  }
}

// ❌ BAD: No port implementation
export class OrderStorage {
  async getOrder(id: string): Promise<any> { }
}
```

### 2. Transform at Boundaries
Convert between domain types and infrastructure types.

```typescript
export class PrismaOrderRepository implements OrderRepository {
  // Domain -> Infrastructure
  private toPersistence(order: Order): PrismaOrderCreate {
    return {
      id: order.id.value,
      customerId: order.customerId.value,
      status: order.status,
      totalAmount: order.total.amount,
      totalCurrency: order.total.currency,
      items: order.items.map(item => ({
        productId: item.productId.value,
        quantity: item.quantity,
        unitPrice: item.unitPrice.amount,
      })),
    };
  }
  
  // Infrastructure -> Domain
  private toDomain(record: PrismaOrderWithItems): Order {
    return new Order(
      OrderId.from(record.id),
      CustomerId.from(record.customerId),
      record.items.map(this.itemToDomain),
      record.status as OrderStatus,
      new Money(record.totalAmount, record.totalCurrency as Currency),
      record.createdAt,
    );
  }
}
```

### 3. Handle Infrastructure Errors
Convert infrastructure exceptions to domain-friendly errors.

```typescript
export class PrismaOrderRepository implements OrderRepository {
  async save(order: Order): Promise<void> {
    try {
      await this.prisma.order.upsert(/* ... */);
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          throw new DuplicateOrderError(order.id);
        }
        if (error.code === "P2025") {
          throw new OrderNotFoundError(order.id);
        }
      }
      throw new RepositoryError("Failed to save order", error);
    }
  }
}
```

### 4. Keep Adapters Thin
Adapters translate, they don't contain business logic.

```typescript
// ✅ GOOD: Thin adapter, pure translation
@Post("/orders")
async createOrder(req: Request, res: Response): Promise<void> {
  const command: CreateOrderCommand = {
    customerId: req.body.customerId,
    items: req.body.items,
  };
  
  const orderId = await this.createOrderUseCase.execute(command);
  
  res.status(201).json({ orderId: orderId.value });
}

// ❌ BAD: Business logic in adapter
@Post("/orders")
async createOrder(req: Request, res: Response): Promise<void> {
  // Validation and business logic should be in use case
  if (req.body.items.length === 0) {
    return res.status(400).json({ error: "Order must have items" });
  }
  
  const discount = req.body.items.length > 5 ? 0.1 : 0;
  // ...
}
```

## Patterns

### HTTP Adapter (Primary)

```typescript
// adapters/http/order-controller.ts
export class OrderController {
  constructor(
    private createOrder: CreateOrderUseCase,
    private getOrder: GetOrderQuery,
    private submitOrder: SubmitOrderUseCase,
  ) {}
  
  @Post("/orders")
  async create(req: Request, res: Response): Promise<void> {
    const result = CreateOrderSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ errors: result.error.flatten() });
    }
    
    try {
      const orderId = await this.createOrder.execute(result.data);
      res.status(201).json({ id: orderId.value });
    } catch (error) {
      this.handleError(error, res);
    }
  }
  
  @Get("/orders/:id")
  async get(req: Request, res: Response): Promise<void> {
    const order = await this.getOrder.execute({ orderId: req.params.id });
    
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    
    res.json({ data: order });
  }
  
  private handleError(error: unknown, res: Response): void {
    if (error instanceof OrderNotFoundError) {
      res.status(404).json({ error: error.message });
    } else if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
```

### Database Adapter (Secondary)

```typescript
// adapters/database/prisma-order-repository.ts
export class PrismaOrderRepository implements OrderRepository {
  constructor(private prisma: PrismaClient) {}
  
  async findById(id: OrderId): Promise<Order | null> {
    const record = await this.prisma.order.findUnique({
      where: { id: id.value },
      include: { items: true },
    });
    return record ? this.toDomain(record) : null;
  }
  
  async findByCustomerId(customerId: CustomerId): Promise<Order[]> {
    const records = await this.prisma.order.findMany({
      where: { customerId: customerId.value },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
    return records.map(this.toDomain);
  }
  
  async save(order: Order): Promise<void> {
    const data = this.toPersistence(order);
    await this.prisma.order.upsert({
      where: { id: order.id.value },
      create: data,
      update: data,
    });
  }
  
  async delete(id: OrderId): Promise<void> {
    await this.prisma.order.delete({
      where: { id: id.value },
    });
  }
  
  nextId(): OrderId {
    return OrderId.generate();
  }
  
  private toDomain(record: OrderWithItems): Order {
    return new Order(
      OrderId.from(record.id),
      CustomerId.from(record.customerId),
      record.items.map(this.itemToDomain),
      record.status as OrderStatus,
      new Money(Number(record.totalAmount), record.totalCurrency as Currency),
      record.createdAt,
    );
  }
  
  private itemToDomain(item: PrismaOrderItem): OrderItem {
    return new OrderItem(
      ProductId.from(item.productId),
      new Money(Number(item.unitPrice), Currency.USD),
      item.quantity,
    );
  }
  
  private toPersistence(order: Order): PrismaOrderUpsert {
    return {
      id: order.id.value,
      customerId: order.customerId.value,
      status: order.status,
      totalAmount: order.total.amount,
      totalCurrency: order.total.currency,
      createdAt: order.createdAt,
      items: {
        deleteMany: {},
        create: order.items.map(item => ({
          productId: item.productId.value,
          quantity: item.quantity,
          unitPrice: item.unitPrice.amount,
        })),
      },
    };
  }
}
```

### External Service Adapter (Secondary)

```typescript
// adapters/external/stripe-payment-gateway.ts
export class StripePaymentGateway implements PaymentGateway {
  constructor(private stripe: Stripe) {}
  
  async charge(payment: Payment): Promise<PaymentResult> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: payment.amount.toSmallestUnit(),
        currency: payment.amount.currency.toLowerCase(),
        payment_method: payment.paymentMethodId,
        confirm: true,
      });
      
      return {
        success: true,
        transactionId: paymentIntent.id,
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeCardError) {
        return {
          success: false,
          error: new PaymentDeclinedError(error.message),
        };
      }
      throw new PaymentGatewayError("Payment processing failed", error);
    }
  }
  
  async refund(paymentId: PaymentId): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create({
      payment_intent: paymentId.value,
    });
    
    return {
      success: refund.status === "succeeded",
      refundId: refund.id,
    };
  }
}
```

## File Organization

```
adapters/
├── http/
│   ├── controllers/
│   │   ├── order-controller.ts
│   │   └── customer-controller.ts
│   ├── middleware/
│   │   ├── auth-middleware.ts
│   │   └── error-handler.ts
│   ├── schemas/
│   │   └── order-schemas.ts
│   └── server.ts
├── database/
│   ├── prisma/
│   │   ├── prisma-order-repository.ts
│   │   └── prisma-customer-repository.ts
│   ├── migrations/
│   └── client.ts
├── external/
│   ├── stripe-payment-gateway.ts
│   ├── sendgrid-email-sender.ts
│   └── twilio-sms-sender.ts
├── messaging/
│   ├── rabbitmq-event-publisher.ts
│   └── rabbitmq-event-consumer.ts
└── index.ts
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| HTTP Controllers | `{entity}-controller.ts` | `order-controller.ts` |
| Repository Implementations | `{tech}-{entity}-repository.ts` | `prisma-order-repository.ts` |
| External Service Adapters | `{provider}-{service}.ts` | `stripe-payment-gateway.ts` |

## Dependencies

### MAY Import
- Domain types (`../domain/`)
- Ports (`../ports/`)
- Application services (for injection)
- Framework and infrastructure libraries

### MUST NOT Import
- Other adapters (adapters shouldn't know about each other)

## Testing

### Integration Tests for Repositories

```typescript
describe("PrismaOrderRepository", () => {
  let repository: PrismaOrderRepository;
  let prisma: PrismaClient;
  
  beforeAll(async () => {
    prisma = new PrismaClient();
    repository = new PrismaOrderRepository(prisma);
  });
  
  afterEach(async () => {
    await prisma.order.deleteMany();
  });
  
  it("should save and retrieve order", async () => {
    const order = Order.create(customerId);
    order.addItem(product, 2);
    
    await repository.save(order);
    const retrieved = await repository.findById(order.id);
    
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id.equals(order.id)).toBe(true);
    expect(retrieved!.items).toHaveLength(1);
  });
});
```

### Unit Tests with Mocked External Services

```typescript
describe("StripePaymentGateway", () => {
  let gateway: StripePaymentGateway;
  let mockStripe: jest.Mocked<Stripe>;
  
  beforeEach(() => {
    mockStripe = createMockStripe();
    gateway = new StripePaymentGateway(mockStripe);
  });
  
  it("should return success for approved payment", async () => {
    mockStripe.paymentIntents.create.mockResolvedValue({
      id: "pi_123",
      status: "succeeded",
    } as any);
    
    const result = await gateway.charge(payment);
    
    expect(result.success).toBe(true);
    expect(result.transactionId).toBe("pi_123");
  });
});
```

