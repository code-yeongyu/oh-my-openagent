# Entities Layer Instructions

## Purpose

This directory contains Enterprise Business Rules. Entities encapsulate enterprise-wide business rules and data. They are the most general and high-level rules that would exist even if the application didn't exist.

## Responsibilities

- Define core business entities
- Encapsulate enterprise-wide business rules
- Represent critical business data structures
- Be completely independent of any application or framework
- Could be used by many different applications in the enterprise

## Rules

### 1. Enterprise-Level Abstraction
Entities represent business concepts that exist independently of any single application.

```typescript
// ✅ GOOD: Enterprise business rule
export class Invoice {
  constructor(
    public readonly id: InvoiceId,
    private lineItems: LineItem[],
    private status: InvoiceStatus,
  ) {}
  
  // Enterprise business rule: calculate total with tax
  calculateTotal(): Money {
    const subtotal = this.lineItems.reduce(
      (sum, item) => sum.add(item.amount),
      Money.zero(),
    );
    return subtotal.add(this.calculateTax());
  }
  
  // Enterprise business rule: tax calculation
  private calculateTax(): Money {
    const taxableAmount = this.lineItems
      .filter(item => item.isTaxable)
      .reduce((sum, item) => sum.add(item.amount), Money.zero());
    return taxableAmount.multiply(this.taxRate);
  }
}
```

### 2. Zero Dependencies
Entities must have absolutely no external dependencies - not even on use cases.

```typescript
// ✅ GOOD: Pure entity
export class Customer {
  constructor(
    public readonly id: CustomerId,
    public readonly email: Email,
    private creditLimit: Money,
    private currentBalance: Money,
  ) {}
  
  canMakePurchase(amount: Money): boolean {
    const newBalance = this.currentBalance.add(amount);
    return newBalance.isLessThanOrEqual(this.creditLimit);
  }
}

// ❌ BAD: Entity with framework dependency
import { Entity, Column } from "typeorm";

@Entity()
export class Customer {
  @Column()
  creditLimit: number;
}
```

### 3. Rich Business Logic
Entities encapsulate business rules, not just data.

```typescript
// ✅ GOOD: Rich entity with business logic
export class LoyaltyAccount {
  constructor(
    public readonly id: AccountId,
    private points: number,
    private tier: LoyaltyTier,
  ) {}
  
  earnPoints(purchaseAmount: Money): void {
    const basePoints = Math.floor(purchaseAmount.amount / 100);
    const multiplier = this.getTierMultiplier();
    this.points += basePoints * multiplier;
    this.evaluateTierUpgrade();
  }
  
  redeemPoints(pointsToRedeem: number): Money {
    if (pointsToRedeem > this.points) {
      throw new InsufficientPointsError(this.points, pointsToRedeem);
    }
    this.points -= pointsToRedeem;
    return Money.of(pointsToRedeem / 100); // 100 points = $1
  }
  
  private getTierMultiplier(): number {
    switch (this.tier) {
      case LoyaltyTier.BRONZE: return 1;
      case LoyaltyTier.SILVER: return 1.5;
      case LoyaltyTier.GOLD: return 2;
      case LoyaltyTier.PLATINUM: return 3;
    }
  }
  
  private evaluateTierUpgrade(): void {
    if (this.points >= 10000 && this.tier !== LoyaltyTier.PLATINUM) {
      this.tier = LoyaltyTier.PLATINUM;
    } else if (this.points >= 5000 && this.tier === LoyaltyTier.BRONZE) {
      this.tier = LoyaltyTier.GOLD;
    } else if (this.points >= 1000 && this.tier === LoyaltyTier.BRONZE) {
      this.tier = LoyaltyTier.SILVER;
    }
  }
}
```

### 4. Self-Validating
Entities validate their own invariants.

```typescript
export class Email {
  private constructor(public readonly value: string) {}
  
  static create(value: string): Email {
    if (!Email.isValid(value)) {
      throw new InvalidEmailError(value);
    }
    return new Email(value.toLowerCase());
  }
  
  private static isValid(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}

export class Money {
  constructor(
    public readonly amount: number,
    public readonly currency: Currency,
  ) {
    if (amount < 0) {
      throw new NegativeMoneyError(amount);
    }
  }
}
```

## Patterns

### Entity with Identity

```typescript
// entities/order.ts
export class Order {
  private events: DomainEvent[] = [];
  
  constructor(
    public readonly id: OrderId,
    public readonly customerId: CustomerId,
    private items: OrderItem[],
    private status: OrderStatus,
    public readonly placedAt: Date,
  ) {}
  
  static create(customerId: CustomerId): Order {
    return new Order(
      OrderId.generate(),
      customerId,
      [],
      OrderStatus.PENDING,
      new Date(),
    );
  }
  
  addItem(product: Product, quantity: number): void {
    this.assertCanModify();
    const item = new OrderItem(product.id, product.price, quantity);
    this.items.push(item);
  }
  
  removeItem(productId: ProductId): void {
    this.assertCanModify();
    this.items = this.items.filter(i => !i.productId.equals(productId));
  }
  
  confirm(): void {
    this.assertCanModify();
    if (this.items.length === 0) {
      throw new EmptyOrderError(this.id);
    }
    this.status = OrderStatus.CONFIRMED;
    this.events.push(new OrderConfirmedEvent(this.id, this.total));
  }
  
  ship(trackingNumber: string): void {
    if (this.status !== OrderStatus.CONFIRMED) {
      throw new InvalidOrderStateError(this.id, this.status, "ship");
    }
    this.status = OrderStatus.SHIPPED;
    this.events.push(new OrderShippedEvent(this.id, trackingNumber));
  }
  
  get total(): Money {
    return this.items.reduce(
      (sum, item) => sum.add(item.subtotal),
      Money.zero(Currency.USD),
    );
  }
  
  pullEvents(): DomainEvent[] {
    const events = [...this.events];
    this.events = [];
    return events;
  }
  
  private assertCanModify(): void {
    if (this.status !== OrderStatus.PENDING) {
      throw new OrderNotModifiableError(this.id, this.status);
    }
  }
}
```

### Value Object

```typescript
// entities/value-objects/money.ts
export class Money {
  constructor(
    public readonly amount: number,
    public readonly currency: Currency,
  ) {
    if (amount < 0) {
      throw new NegativeMoneyError(amount);
    }
  }
  
  static zero(currency: Currency = Currency.USD): Money {
    return new Money(0, currency);
  }
  
  static of(amount: number, currency: Currency = Currency.USD): Money {
    return new Money(amount, currency);
  }
  
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }
  
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }
  
  multiply(factor: number): Money {
    return new Money(this.amount * factor, this.currency);
  }
  
  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }
  
  isLessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount <= other.amount;
  }
  
  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }
  
  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
```

### Aggregate Root

```typescript
// entities/shopping-cart.ts
export class ShoppingCart {
  constructor(
    public readonly id: CartId,
    public readonly customerId: CustomerId,
    private items: Map<ProductId, CartItem>,
    private createdAt: Date,
  ) {}
  
  static create(customerId: CustomerId): ShoppingCart {
    return new ShoppingCart(
      CartId.generate(),
      customerId,
      new Map(),
      new Date(),
    );
  }
  
  addItem(product: Product, quantity: number): void {
    const productId = product.id;
    const existingItem = this.items.get(productId);
    
    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;
      this.items.set(productId, existingItem.withQuantity(newQuantity));
    } else {
      this.items.set(productId, new CartItem(productId, product.price, quantity));
    }
  }
  
  updateQuantity(productId: ProductId, quantity: number): void {
    if (!this.items.has(productId)) {
      throw new ItemNotInCartError(this.id, productId);
    }
    
    if (quantity <= 0) {
      this.items.delete(productId);
    } else {
      const item = this.items.get(productId)!;
      this.items.set(productId, item.withQuantity(quantity));
    }
  }
  
  removeItem(productId: ProductId): void {
    this.items.delete(productId);
  }
  
  clear(): void {
    this.items.clear();
  }
  
  get isEmpty(): boolean {
    return this.items.size === 0;
  }
  
  get itemCount(): number {
    return Array.from(this.items.values()).reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
  }
  
  get subtotal(): Money {
    return Array.from(this.items.values()).reduce(
      (sum, item) => sum.add(item.subtotal),
      Money.zero(),
    );
  }
}
```

## File Organization

```
entities/
├── order.ts
├── customer.ts
├── product.ts
├── shopping-cart.ts
├── value-objects/
│   ├── money.ts
│   ├── email.ts
│   ├── order-id.ts
│   └── product-id.ts
├── errors/
│   ├── entity-errors.ts
│   └── validation-errors.ts
├── events/
│   ├── domain-event.ts
│   └── order-events.ts
└── index.ts
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Entity Files | `{entity}.ts` | `order.ts` |
| Value Object Files | `{concept}.ts` | `money.ts` |
| Entity Classes | `{Entity}` | `Order` |
| Value Object Classes | `{Concept}` | `Money` |
| ID Value Objects | `{Entity}Id` | `OrderId` |

## Dependencies

### MAY Import
- Nothing - entities are completely self-contained
- Other entities and value objects within the same layer

### MUST NOT Import
- Use cases (`../use-cases/`)
- Interfaces (`../interfaces/`)
- Frameworks (`../frameworks/`)
- Any external library

## Testing

```typescript
describe("Order", () => {
  describe("create", () => {
    it("should create pending order", () => {
      const order = Order.create(customerId);
      expect(order.status).toBe(OrderStatus.PENDING);
    });
  });
  
  describe("addItem", () => {
    it("should add item to pending order", () => {
      const order = Order.create(customerId);
      order.addItem(product, 2);
      expect(order.items).toHaveLength(1);
    });
    
    it("should throw when adding to confirmed order", () => {
      const order = Order.create(customerId);
      order.addItem(product, 1);
      order.confirm();
      
      expect(() => order.addItem(product, 1)).toThrow(OrderNotModifiableError);
    });
  });
  
  describe("confirm", () => {
    it("should throw for empty order", () => {
      const order = Order.create(customerId);
      expect(() => order.confirm()).toThrow(EmptyOrderError);
    });
    
    it("should emit OrderConfirmedEvent", () => {
      const order = Order.create(customerId);
      order.addItem(product, 1);
      order.confirm();
      
      const events = order.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(OrderConfirmedEvent);
    });
  });
});
```

