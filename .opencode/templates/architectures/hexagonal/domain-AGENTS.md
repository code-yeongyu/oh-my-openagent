# Domain Layer Instructions

## Purpose

This directory contains the core business logic. The domain is the heart of the application, completely isolated from infrastructure and framework concerns.

## Responsibilities

- Define domain entities with identity and lifecycle
- Define value objects for immutable concepts
- Implement domain services for complex operations
- Express business invariants and rules
- Define domain events

## Rules

### 1. Zero External Dependencies
The domain MUST NOT depend on any external framework, library, or infrastructure code.

```typescript
// ✅ GOOD: Pure domain code
export class Order {
  constructor(
    public readonly id: OrderId,
    public readonly customerId: CustomerId,
    private items: OrderItem[],
    private status: OrderStatus,
  ) {}
  
  addItem(item: OrderItem): void {
    if (this.status !== OrderStatus.DRAFT) {
      throw new OrderNotEditableError(this.id);
    }
    this.items.push(item);
  }
}

// ❌ BAD: Framework dependency in domain
import { Entity, Column } from "typeorm";

@Entity()
export class Order {
  @Column()
  status: string;
}
```

### 2. Rich Domain Models
Entities encapsulate business logic, not just data.

```typescript
// ✅ GOOD: Rich domain model
class BankAccount {
  constructor(
    public readonly id: AccountId,
    private balance: Money,
    private status: AccountStatus,
  ) {}
  
  withdraw(amount: Money): void {
    if (this.status !== AccountStatus.ACTIVE) {
      throw new AccountInactiveError(this.id);
    }
    if (amount.isGreaterThan(this.balance)) {
      throw new InsufficientFundsError(this.id, amount, this.balance);
    }
    this.balance = this.balance.subtract(amount);
  }
  
  deposit(amount: Money): void {
    if (this.status !== AccountStatus.ACTIVE) {
      throw new AccountInactiveError(this.id);
    }
    this.balance = this.balance.add(amount);
  }
}

// ❌ BAD: Anemic domain model
interface BankAccount {
  id: string;
  balance: number;
  status: string;
}
// Business logic elsewhere...
```

### 3. Value Objects for Concepts
Use value objects for concepts defined by their attributes, not identity.

```typescript
// ✅ GOOD: Value object
class Money {
  constructor(
    public readonly amount: number,
    public readonly currency: Currency,
  ) {
    if (amount < 0) {
      throw new NegativeAmountError(amount);
    }
  }
  
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }
  
  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }
}
```

### 4. Domain Events for Side Effects
Use domain events to signal significant occurrences.

```typescript
// ✅ GOOD: Domain events
class Order {
  private events: DomainEvent[] = [];
  
  complete(): void {
    this.status = OrderStatus.COMPLETED;
    this.events.push(new OrderCompletedEvent(this.id, this.total));
  }
  
  pullEvents(): DomainEvent[] {
    const events = [...this.events];
    this.events = [];
    return events;
  }
}
```

### 5. Aggregate Roots
Define clear aggregate boundaries with a single entry point.

```typescript
// ✅ GOOD: Aggregate root controls access
class Order {
  private items: OrderItem[] = [];
  
  // Order is the aggregate root - all modifications go through it
  addItem(product: Product, quantity: number): void {
    const item = new OrderItem(product.id, product.price, quantity);
    this.items.push(item);
    this.recalculateTotal();
  }
  
  removeItem(productId: ProductId): void {
    this.items = this.items.filter(item => !item.productId.equals(productId));
    this.recalculateTotal();
  }
}

// ❌ BAD: Exposing internal collections
class Order {
  public items: OrderItem[] = [];  // External code can modify directly
}
```

## Patterns

### Entity

```typescript
// entities/order.ts
export class Order {
  private events: DomainEvent[] = [];
  
  constructor(
    public readonly id: OrderId,
    public readonly customerId: CustomerId,
    private items: OrderItem[],
    private status: OrderStatus,
    private total: Money,
    public readonly createdAt: Date,
  ) {}
  
  static create(customerId: CustomerId): Order {
    return new Order(
      OrderId.generate(),
      customerId,
      [],
      OrderStatus.DRAFT,
      Money.zero(Currency.USD),
      new Date(),
    );
  }
  
  addItem(product: Product, quantity: number): void {
    this.assertEditable();
    const item = OrderItem.create(product, quantity);
    this.items.push(item);
    this.recalculateTotal();
  }
  
  submit(): void {
    this.assertEditable();
    if (this.items.length === 0) {
      throw new EmptyOrderError(this.id);
    }
    this.status = OrderStatus.SUBMITTED;
    this.events.push(new OrderSubmittedEvent(this.id, this.customerId, this.total));
  }
  
  private assertEditable(): void {
    if (this.status !== OrderStatus.DRAFT) {
      throw new OrderNotEditableError(this.id);
    }
  }
  
  private recalculateTotal(): void {
    this.total = this.items.reduce(
      (sum, item) => sum.add(item.subtotal),
      Money.zero(this.total.currency),
    );
  }
}
```

### Value Object

```typescript
// value-objects/order-id.ts
export class OrderId {
  private constructor(public readonly value: string) {}
  
  static generate(): OrderId {
    return new OrderId(crypto.randomUUID());
  }
  
  static from(value: string): OrderId {
    if (!OrderId.isValid(value)) {
      throw new InvalidOrderIdError(value);
    }
    return new OrderId(value);
  }
  
  static isValid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
  
  equals(other: OrderId): boolean {
    return this.value === other.value;
  }
  
  toString(): string {
    return this.value;
  }
}
```

### Domain Service

```typescript
// services/pricing-service.ts
export class PricingService {
  calculateDiscount(order: Order, customer: Customer): Money {
    let discount = Money.zero(order.total.currency);
    
    // Loyalty discount
    if (customer.loyaltyTier === LoyaltyTier.GOLD) {
      discount = discount.add(order.total.multiply(0.10));
    } else if (customer.loyaltyTier === LoyaltyTier.SILVER) {
      discount = discount.add(order.total.multiply(0.05));
    }
    
    // Volume discount
    if (order.itemCount > 10) {
      discount = discount.add(order.total.multiply(0.03));
    }
    
    return discount;
  }
}
```

### Domain Event

```typescript
// events/order-events.ts
export abstract class DomainEvent {
  public readonly occurredAt: Date = new Date();
  abstract readonly eventType: string;
}

export class OrderSubmittedEvent extends DomainEvent {
  readonly eventType = "order.submitted";
  
  constructor(
    public readonly orderId: OrderId,
    public readonly customerId: CustomerId,
    public readonly total: Money,
  ) {
    super();
  }
}
```

## File Organization

```
domain/
├── entities/
│   ├── order.ts
│   ├── customer.ts
│   └── product.ts
├── value-objects/
│   ├── order-id.ts
│   ├── money.ts
│   └── email.ts
├── services/
│   ├── pricing-service.ts
│   └── inventory-service.ts
├── events/
│   ├── domain-event.ts
│   └── order-events.ts
├── errors/
│   └── domain-errors.ts
└── index.ts
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Entity Files | `{entity}.ts` | `order.ts` |
| Value Object Files | `{concept}.ts` | `money.ts` |
| Service Files | `{domain}-service.ts` | `pricing-service.ts` |
| Event Files | `{entity}-events.ts` | `order-events.ts` |
| Entity Classes | `{Entity}` | `Order` |
| Value Object Classes | `{Concept}` | `Money` |
| Domain Services | `{Domain}Service` | `PricingService` |

## Dependencies

### MAY Import
- Nothing external - domain is self-contained
- Other domain types (entities, value objects)

### MUST NOT Import
- Ports (`../ports/`)
- Adapters (`../adapters/`)
- Application (`../application/`)
- Any framework or infrastructure code

## Testing

```typescript
describe("Order", () => {
  it("should create draft order", () => {
    const order = Order.create(customerId);
    
    expect(order.status).toBe(OrderStatus.DRAFT);
    expect(order.items).toHaveLength(0);
  });
  
  it("should add items to draft order", () => {
    const order = Order.create(customerId);
    
    order.addItem(product, 2);
    
    expect(order.items).toHaveLength(1);
    expect(order.total).toEqual(product.price.multiply(2));
  });
  
  it("should not add items to submitted order", () => {
    const order = Order.create(customerId);
    order.addItem(product, 1);
    order.submit();
    
    expect(() => order.addItem(product, 1)).toThrow(OrderNotEditableError);
  });
  
  it("should emit event when order submitted", () => {
    const order = Order.create(customerId);
    order.addItem(product, 1);
    
    order.submit();
    
    const events = order.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(OrderSubmittedEvent);
  });
});
```

