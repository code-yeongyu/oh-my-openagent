# Use Cases Layer Instructions

## Purpose

This directory contains Application Business Rules. Use cases orchestrate the flow of data to and from entities, directing them to use their enterprise-wide business rules to achieve the goals of the use case.

## Responsibilities

- Define application-specific business rules
- Orchestrate entities to accomplish use case goals
- Coordinate data flow between entities and outer layers
- Define input and output boundaries (ports)
- Handle application-level validation

## Rules

### 1. One Use Case, One Class
Each use case is encapsulated in its own class with a single public method.

```typescript
// ✅ GOOD: Single use case per class
export class PlaceOrderUseCase {
  async execute(request: PlaceOrderRequest): Promise<PlaceOrderResponse> { }
}

export class CancelOrderUseCase {
  async execute(request: CancelOrderRequest): Promise<void> { }
}

// ❌ BAD: Multiple use cases in one class
export class OrderUseCases {
  async placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResponse> { }
  async cancelOrder(request: CancelOrderRequest): Promise<void> { }
  async getOrder(request: GetOrderRequest): Promise<GetOrderResponse> { }
}
```

### 2. Depend Only on Entities
Use cases may only depend on the entities layer.

```typescript
// ✅ GOOD: Depends only on entities
import { Order, Customer, Money } from "../entities";

export class PlaceOrderUseCase {
  constructor(
    private orderGateway: OrderGateway,
    private customerGateway: CustomerGateway,
  ) {}
  
  async execute(request: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    const customer = await this.customerGateway.findById(request.customerId);
    const order = Order.create(customer.id);
    // ...
  }
}

// ❌ BAD: Depends on outer layers
import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";

export class PlaceOrderUseCase {
  // Framework dependency!
  constructor(private prisma: PrismaClient) {}
}
```

### 3. Use Gateway Interfaces
Define interfaces for external dependencies (gateways), not concrete implementations.

```typescript
// Use case defines what it needs (interface)
export interface OrderGateway {
  findById(id: OrderId): Promise<Order | null>;
  save(order: Order): Promise<void>;
}

export class PlaceOrderUseCase {
  constructor(private orderGateway: OrderGateway) {}
}

// Implementation is in interfaces layer (gateway implementation)
// or frameworks layer (database-specific implementation)
```

### 4. Request/Response Boundaries
Use simple data structures for input and output.

```typescript
// Request DTO (input boundary)
export interface PlaceOrderRequest {
  customerId: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
  shippingAddress: {
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
}

// Response DTO (output boundary)
export interface PlaceOrderResponse {
  orderId: string;
  total: {
    amount: number;
    currency: string;
  };
  estimatedDelivery: string;
}
```

### 5. No Direct I/O
Use cases don't directly access databases, HTTP, or file systems.

```typescript
// ✅ GOOD: Uses gateway interface
async execute(request: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  const order = await this.orderGateway.findById(orderId);
  // ...
}

// ❌ BAD: Direct database access
async execute(request: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  // ...
}
```

## Patterns

### Use Case Interactor

```typescript
// use-cases/place-order-use-case.ts
export class PlaceOrderUseCase {
  constructor(
    private orderGateway: OrderGateway,
    private customerGateway: CustomerGateway,
    private productGateway: ProductGateway,
    private inventoryGateway: InventoryGateway,
    private presenter: PlaceOrderPresenter,
  ) {}
  
  async execute(request: PlaceOrderRequest): Promise<void> {
    // 1. Validate request
    this.validateRequest(request);
    
    // 2. Load entities
    const customer = await this.getCustomer(request.customerId);
    const products = await this.getProducts(request.items);
    
    // 3. Check inventory
    await this.checkInventory(request.items);
    
    // 4. Apply business rules via entities
    const order = Order.create(customer.id);
    for (const item of request.items) {
      const product = products.get(item.productId)!;
      order.addItem(product, item.quantity);
    }
    order.setShippingAddress(Address.from(request.shippingAddress));
    order.confirm();
    
    // 5. Persist
    await this.orderGateway.save(order);
    
    // 6. Present result
    this.presenter.presentSuccess({
      orderId: order.id.value,
      total: {
        amount: order.total.amount,
        currency: order.total.currency,
      },
      estimatedDelivery: this.calculateDeliveryDate(order),
    });
  }
  
  private validateRequest(request: PlaceOrderRequest): void {
    if (!request.customerId) {
      throw new ValidationError("Customer ID is required");
    }
    if (!request.items || request.items.length === 0) {
      throw new ValidationError("Order must have at least one item");
    }
  }
  
  private async getCustomer(customerId: string): Promise<Customer> {
    const customer = await this.customerGateway.findById(CustomerId.from(customerId));
    if (!customer) {
      throw new CustomerNotFoundError(customerId);
    }
    return customer;
  }
  
  private async getProducts(items: PlaceOrderRequest["items"]): Promise<Map<string, Product>> {
    const products = new Map<string, Product>();
    for (const item of items) {
      const product = await this.productGateway.findById(ProductId.from(item.productId));
      if (!product) {
        throw new ProductNotFoundError(item.productId);
      }
      products.set(item.productId, product);
    }
    return products;
  }
  
  private async checkInventory(items: PlaceOrderRequest["items"]): Promise<void> {
    for (const item of items) {
      const available = await this.inventoryGateway.getAvailableQuantity(
        ProductId.from(item.productId),
      );
      if (available < item.quantity) {
        throw new InsufficientInventoryError(item.productId, item.quantity, available);
      }
    }
  }
  
  private calculateDeliveryDate(order: Order): string {
    const deliveryDays = order.isExpress ? 2 : 5;
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + deliveryDays);
    return deliveryDate.toISOString();
  }
}
```

### Gateway Interfaces

```typescript
// use-cases/gateways/order-gateway.ts
export interface OrderGateway {
  findById(id: OrderId): Promise<Order | null>;
  findByCustomerId(customerId: CustomerId): Promise<Order[]>;
  save(order: Order): Promise<void>;
  delete(id: OrderId): Promise<void>;
}

// use-cases/gateways/customer-gateway.ts
export interface CustomerGateway {
  findById(id: CustomerId): Promise<Customer | null>;
  findByEmail(email: Email): Promise<Customer | null>;
  save(customer: Customer): Promise<void>;
}

// use-cases/gateways/inventory-gateway.ts
export interface InventoryGateway {
  getAvailableQuantity(productId: ProductId): Promise<number>;
  reserve(productId: ProductId, quantity: number): Promise<ReservationId>;
  release(reservationId: ReservationId): Promise<void>;
}
```

### Presenter Interface (Output Boundary)

```typescript
// use-cases/presenters/place-order-presenter.ts
export interface PlaceOrderPresenter {
  presentSuccess(response: PlaceOrderResponse): void;
  presentError(error: UseCaseError): void;
}

export interface PlaceOrderResponse {
  orderId: string;
  total: { amount: number; currency: string };
  estimatedDelivery: string;
}
```

### Query Use Case

```typescript
// use-cases/get-order-use-case.ts
export class GetOrderUseCase {
  constructor(
    private orderGateway: OrderGateway,
    private presenter: GetOrderPresenter,
  ) {}
  
  async execute(request: GetOrderRequest): Promise<void> {
    const order = await this.orderGateway.findById(OrderId.from(request.orderId));
    
    if (!order) {
      this.presenter.presentNotFound(request.orderId);
      return;
    }
    
    this.presenter.presentOrder(this.toResponse(order));
  }
  
  private toResponse(order: Order): OrderResponse {
    return {
      id: order.id.value,
      customerId: order.customerId.value,
      status: order.status,
      items: order.items.map(item => ({
        productId: item.productId.value,
        quantity: item.quantity,
        unitPrice: item.unitPrice.amount,
        subtotal: item.subtotal.amount,
      })),
      total: {
        amount: order.total.amount,
        currency: order.total.currency,
      },
      placedAt: order.placedAt.toISOString(),
    };
  }
}
```

## File Organization

```
use-cases/
├── place-order/
│   ├── place-order-use-case.ts
│   ├── place-order-request.ts
│   ├── place-order-response.ts
│   └── place-order-presenter.ts
├── cancel-order/
│   ├── cancel-order-use-case.ts
│   └── cancel-order-request.ts
├── get-order/
│   ├── get-order-use-case.ts
│   ├── get-order-request.ts
│   └── get-order-presenter.ts
├── gateways/
│   ├── order-gateway.ts
│   ├── customer-gateway.ts
│   └── inventory-gateway.ts
├── errors/
│   └── use-case-errors.ts
└── index.ts
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Use Case Classes | `{Action}{Entity}UseCase` | `PlaceOrderUseCase` |
| Request DTOs | `{Action}{Entity}Request` | `PlaceOrderRequest` |
| Response DTOs | `{Action}{Entity}Response` | `PlaceOrderResponse` |
| Presenters | `{Action}{Entity}Presenter` | `PlaceOrderPresenter` |
| Gateways | `{Entity}Gateway` | `OrderGateway` |

## Dependencies

### MAY Import
- Entities (`../entities/`)

### MUST NOT Import
- Interfaces (`../interfaces/`)
- Frameworks (`../frameworks/`)
- Any framework, database, or external library

## Testing

```typescript
describe("PlaceOrderUseCase", () => {
  let useCase: PlaceOrderUseCase;
  let orderGateway: jest.Mocked<OrderGateway>;
  let customerGateway: jest.Mocked<CustomerGateway>;
  let productGateway: jest.Mocked<ProductGateway>;
  let inventoryGateway: jest.Mocked<InventoryGateway>;
  let presenter: jest.Mocked<PlaceOrderPresenter>;
  
  beforeEach(() => {
    orderGateway = createMockOrderGateway();
    customerGateway = createMockCustomerGateway();
    productGateway = createMockProductGateway();
    inventoryGateway = createMockInventoryGateway();
    presenter = createMockPresenter();
    
    useCase = new PlaceOrderUseCase(
      orderGateway,
      customerGateway,
      productGateway,
      inventoryGateway,
      presenter,
    );
  });
  
  it("should place order successfully", async () => {
    customerGateway.findById.mockResolvedValue(customer);
    productGateway.findById.mockResolvedValue(product);
    inventoryGateway.getAvailableQuantity.mockResolvedValue(100);
    
    await useCase.execute(validRequest);
    
    expect(orderGateway.save).toHaveBeenCalled();
    expect(presenter.presentSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: expect.any(String),
        total: expect.objectContaining({
          amount: expect.any(Number),
        }),
      }),
    );
  });
  
  it("should throw CustomerNotFoundError for invalid customer", async () => {
    customerGateway.findById.mockResolvedValue(null);
    
    await expect(useCase.execute(validRequest)).rejects.toThrow(CustomerNotFoundError);
  });
  
  it("should throw InsufficientInventoryError when out of stock", async () => {
    customerGateway.findById.mockResolvedValue(customer);
    productGateway.findById.mockResolvedValue(product);
    inventoryGateway.getAvailableQuantity.mockResolvedValue(0);
    
    await expect(useCase.execute(validRequest)).rejects.toThrow(InsufficientInventoryError);
  });
});
```

