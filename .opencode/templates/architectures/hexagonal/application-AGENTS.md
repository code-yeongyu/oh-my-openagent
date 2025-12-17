# Application Layer Instructions

## Purpose

This directory contains application services that implement use cases. The application layer orchestrates domain logic and coordinates with external systems through ports.

## Responsibilities

- Implement inbound ports (use cases)
- Orchestrate domain entities and services
- Coordinate transactions
- Handle domain events
- Manage application-level validation
- Transform between commands/queries and domain operations

## Rules

### 1. Implement Use Cases
Application services implement inbound port interfaces.

```typescript
// ✅ GOOD: Implements use case interface
export class CreateOrderService implements CreateOrderUseCase {
  constructor(
    private orderRepository: OrderRepository,
    private customerRepository: CustomerRepository,
    private inventoryChecker: InventoryChecker,
  ) {}
  
  async execute(command: CreateOrderCommand): Promise<OrderId> {
    const customer = await this.customerRepository.findById(
      CustomerId.from(command.customerId),
    );
    if (!customer) {
      throw new CustomerNotFoundError(command.customerId);
    }
    
    await this.validateInventory(command.items);
    
    const order = Order.create(customer.id);
    for (const item of command.items) {
      const product = await this.getProduct(item.productId);
      order.addItem(product, item.quantity);
    }
    
    await this.orderRepository.save(order);
    return order.id;
  }
}
```

### 2. Depend on Ports, Not Adapters
Use port interfaces for all external dependencies.

```typescript
// ✅ GOOD: Depends on port interfaces
export class CreateOrderService implements CreateOrderUseCase {
  constructor(
    private orderRepository: OrderRepository,        // Port
    private inventoryChecker: InventoryChecker,     // Port
    private eventPublisher: EventPublisher,          // Port
  ) {}
}

// ❌ BAD: Depends on concrete adapters
export class CreateOrderService implements CreateOrderUseCase {
  constructor(
    private prisma: PrismaClient,                    // Concrete
    private inventoryApi: AxiosInstance,             // Concrete
    private rabbitMQ: AmqpConnection,                // Concrete
  ) {}
}
```

### 3. Single Use Case per Service
Each application service handles one use case for clarity.

```typescript
// ✅ GOOD: Single responsibility
export class CreateOrderService implements CreateOrderUseCase { }
export class SubmitOrderService implements SubmitOrderUseCase { }
export class CancelOrderService implements CancelOrderUseCase { }

// ❌ BAD: Multiple use cases in one service
export class OrderService {
  async createOrder(command: CreateOrderCommand): Promise<OrderId> { }
  async submitOrder(command: SubmitOrderCommand): Promise<void> { }
  async cancelOrder(command: CancelOrderCommand): Promise<void> { }
}
```

### 4. Transaction Boundaries
Define transaction scope at the use case level.

```typescript
export class TransferFundsService implements TransferFundsUseCase {
  constructor(
    private accountRepository: AccountRepository,
    private transactionManager: TransactionManager,
  ) {}
  
  async execute(command: TransferFundsCommand): Promise<void> {
    await this.transactionManager.run(async () => {
      const fromAccount = await this.accountRepository.findById(
        AccountId.from(command.fromAccountId),
      );
      const toAccount = await this.accountRepository.findById(
        AccountId.from(command.toAccountId),
      );
      
      const amount = Money.of(command.amount, command.currency);
      
      fromAccount.withdraw(amount);
      toAccount.deposit(amount);
      
      await this.accountRepository.save(fromAccount);
      await this.accountRepository.save(toAccount);
    });
  }
}
```

### 5. Handle Domain Events
Process domain events after successful operations.

```typescript
export class SubmitOrderService implements SubmitOrderUseCase {
  constructor(
    private orderRepository: OrderRepository,
    private eventPublisher: EventPublisher,
  ) {}
  
  async execute(command: SubmitOrderCommand): Promise<void> {
    const order = await this.orderRepository.findById(
      OrderId.from(command.orderId),
    );
    if (!order) {
      throw new OrderNotFoundError(command.orderId);
    }
    
    order.submit();
    
    await this.orderRepository.save(order);
    
    // Publish domain events after successful persistence
    const events = order.pullEvents();
    for (const event of events) {
      await this.eventPublisher.publish(event);
    }
  }
}
```

## Patterns

### Command Handler (Write Use Case)

```typescript
// application/commands/create-order-service.ts
export class CreateOrderService implements CreateOrderUseCase {
  constructor(
    private orderRepository: OrderRepository,
    private productRepository: ProductRepository,
    private customerRepository: CustomerRepository,
    private inventoryChecker: InventoryChecker,
    private eventPublisher: EventPublisher,
  ) {}
  
  async execute(command: CreateOrderCommand): Promise<OrderId> {
    // 1. Load required entities
    const customer = await this.getCustomer(command.customerId);
    const products = await this.getProducts(command.items);
    
    // 2. Validate business rules
    await this.validateInventory(command.items);
    
    // 3. Execute domain logic
    const order = Order.create(customer.id);
    for (const item of command.items) {
      const product = products.get(item.productId)!;
      order.addItem(product, item.quantity);
    }
    
    // 4. Persist changes
    await this.orderRepository.save(order);
    
    // 5. Publish events
    await this.publishEvents(order);
    
    return order.id;
  }
  
  private async getCustomer(customerId: string): Promise<Customer> {
    const customer = await this.customerRepository.findById(
      CustomerId.from(customerId),
    );
    if (!customer) {
      throw new CustomerNotFoundError(customerId);
    }
    return customer;
  }
  
  private async getProducts(
    items: CreateOrderCommand["items"],
  ): Promise<Map<string, Product>> {
    const products = new Map<string, Product>();
    for (const item of items) {
      const product = await this.productRepository.findById(
        ProductId.from(item.productId),
      );
      if (!product) {
        throw new ProductNotFoundError(item.productId);
      }
      products.set(item.productId, product);
    }
    return products;
  }
  
  private async validateInventory(
    items: CreateOrderCommand["items"],
  ): Promise<void> {
    for (const item of items) {
      const available = await this.inventoryChecker.checkAvailability(
        ProductId.from(item.productId),
        item.quantity,
      );
      if (!available.isAvailable) {
        throw new InsufficientInventoryError(item.productId, item.quantity);
      }
    }
  }
  
  private async publishEvents(order: Order): Promise<void> {
    const events = order.pullEvents();
    for (const event of events) {
      await this.eventPublisher.publish(event);
    }
  }
}
```

### Query Handler (Read Use Case)

```typescript
// application/queries/get-order-query-handler.ts
export class GetOrderQueryHandler implements GetOrderQuery {
  constructor(private orderRepository: OrderRepository) {}
  
  async execute(params: GetOrderQueryParams): Promise<OrderDTO | null> {
    const order = await this.orderRepository.findById(
      OrderId.from(params.orderId),
    );
    
    if (!order) {
      return null;
    }
    
    return this.toDTO(order);
  }
  
  private toDTO(order: Order): OrderDTO {
    return {
      id: order.id.value,
      customerId: order.customerId.value,
      status: order.status,
      total: {
        amount: order.total.amount,
        currency: order.total.currency,
      },
      items: order.items.map(item => ({
        productId: item.productId.value,
        quantity: item.quantity,
        unitPrice: item.unitPrice.amount,
        subtotal: item.subtotal.amount,
      })),
      createdAt: order.createdAt.toISOString(),
    };
  }
}
```

### Event Handler

```typescript
// application/event-handlers/order-submitted-handler.ts
export class OrderSubmittedHandler implements EventHandler<OrderSubmittedEvent> {
  constructor(
    private notificationService: NotificationService,
    private inventoryService: InventoryService,
  ) {}
  
  async handle(event: OrderSubmittedEvent): Promise<void> {
    // Reserve inventory
    await this.inventoryService.reserveItems(event.orderId);
    
    // Send confirmation
    await this.notificationService.sendOrderConfirmation(
      event.orderId,
      event.customerId,
    );
  }
}
```

## File Organization

```
application/
├── commands/
│   ├── create-order-service.ts
│   ├── submit-order-service.ts
│   └── cancel-order-service.ts
├── queries/
│   ├── get-order-query-handler.ts
│   └── list-orders-query-handler.ts
├── event-handlers/
│   ├── order-submitted-handler.ts
│   └── payment-received-handler.ts
├── services/
│   └── order-saga.ts  # Complex workflows
└── index.ts
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Command Services | `{Action}{Entity}Service` | `CreateOrderService` |
| Query Handlers | `{Action}{Entity}QueryHandler` | `GetOrderQueryHandler` |
| Event Handlers | `{Event}Handler` | `OrderSubmittedHandler` |

## Dependencies

### MAY Import
- Domain types (`../domain/`)
- Ports (`../ports/`)

### MUST NOT Import
- Adapters (`../adapters/`)
- Framework or infrastructure code

## Testing

### Unit Tests with Mocked Ports

```typescript
describe("CreateOrderService", () => {
  let service: CreateOrderService;
  let orderRepository: jest.Mocked<OrderRepository>;
  let customerRepository: jest.Mocked<CustomerRepository>;
  let productRepository: jest.Mocked<ProductRepository>;
  let inventoryChecker: jest.Mocked<InventoryChecker>;
  let eventPublisher: jest.Mocked<EventPublisher>;
  
  beforeEach(() => {
    orderRepository = createMockOrderRepository();
    customerRepository = createMockCustomerRepository();
    productRepository = createMockProductRepository();
    inventoryChecker = createMockInventoryChecker();
    eventPublisher = createMockEventPublisher();
    
    service = new CreateOrderService(
      orderRepository,
      productRepository,
      customerRepository,
      inventoryChecker,
      eventPublisher,
    );
  });
  
  it("should create order for valid command", async () => {
    customerRepository.findById.mockResolvedValue(customer);
    productRepository.findById.mockResolvedValue(product);
    inventoryChecker.checkAvailability.mockResolvedValue({ isAvailable: true });
    
    const command: CreateOrderCommand = {
      customerId: customer.id.value,
      items: [{ productId: product.id.value, quantity: 2 }],
    };
    
    const orderId = await service.execute(command);
    
    expect(orderId).toBeDefined();
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: customer.id,
      }),
    );
  });
  
  it("should throw when customer not found", async () => {
    customerRepository.findById.mockResolvedValue(null);
    
    const command: CreateOrderCommand = {
      customerId: "non-existent",
      items: [],
    };
    
    await expect(service.execute(command)).rejects.toThrow(CustomerNotFoundError);
  });
  
  it("should throw when inventory insufficient", async () => {
    customerRepository.findById.mockResolvedValue(customer);
    productRepository.findById.mockResolvedValue(product);
    inventoryChecker.checkAvailability.mockResolvedValue({ isAvailable: false });
    
    const command: CreateOrderCommand = {
      customerId: customer.id.value,
      items: [{ productId: product.id.value, quantity: 100 }],
    };
    
    await expect(service.execute(command)).rejects.toThrow(InsufficientInventoryError);
  });
});
```

### Integration Tests

```typescript
describe("CreateOrderService Integration", () => {
  let service: CreateOrderService;
  
  beforeAll(() => {
    // Wire up with real adapters for integration testing
    const container = createTestContainer();
    service = container.get(CreateOrderService);
  });
  
  it("should persist order to database", async () => {
    const command: CreateOrderCommand = {
      customerId: testCustomer.id,
      items: [{ productId: testProduct.id, quantity: 1 }],
    };
    
    const orderId = await service.execute(command);
    
    // Verify in database
    const order = await testOrderRepository.findById(orderId);
    expect(order).not.toBeNull();
  });
});
```

