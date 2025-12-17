# Interfaces Layer Instructions

## Purpose

This directory contains Interface Adapters. These convert data from the format most convenient for use cases and entities to the format most convenient for external agencies like databases and the web.

## Responsibilities

- Controllers: Convert web requests to use case input
- Presenters: Convert use case output to view models
- Gateways: Implement gateway interfaces defined by use cases
- Convert data between internal and external formats
- Handle framework-specific concerns

## Components

### Controllers
Receive input from the delivery mechanism (web, CLI) and convert it to a format suitable for use cases.

### Presenters
Convert use case output to a format suitable for the delivery mechanism (JSON, HTML, etc.).

### Gateways
Implement the gateway interfaces defined in the use cases layer, providing concrete data access.

## Rules

### 1. No Business Logic
Interface adapters translate data, they don't make business decisions.

```typescript
// ✅ GOOD: Pure translation
export class OrderController {
  async placeOrder(req: Request): Promise<Response> {
    const request: PlaceOrderRequest = {
      customerId: req.body.customerId,
      items: req.body.items.map((item: any) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
      shippingAddress: req.body.shippingAddress,
    };
    
    await this.placeOrderUseCase.execute(request);
    return this.presenter.getResponse();
  }
}

// ❌ BAD: Business logic in controller
export class OrderController {
  async placeOrder(req: Request): Promise<Response> {
    // Business validation doesn't belong here!
    if (req.body.items.some(item => item.quantity > 100)) {
      return { status: 400, message: "Max 100 items per product" };
    }
    
    // Discount calculation doesn't belong here!
    const discount = req.body.items.length > 5 ? 0.1 : 0;
  }
}
```

### 2. Depend on Inner Layers Only
May depend on use cases and entities, not on frameworks.

```typescript
// ✅ GOOD: Depends on use case interface
export class OrderPresenter implements PlaceOrderPresenter {
  private response: PlaceOrderViewModel;
  
  presentSuccess(data: PlaceOrderResponse): void {
    this.response = {
      success: true,
      orderId: data.orderId,
      total: `$${data.total.amount.toFixed(2)}`,
      estimatedDelivery: this.formatDate(data.estimatedDelivery),
    };
  }
}

// ❌ BAD: Framework dependency
import { Response } from "express";

export class OrderPresenter {
  constructor(private res: Response) {}
  
  present(data: any): void {
    this.res.json(data);  // Framework coupled!
  }
}
```

### 3. Map Between Formats
Convert between internal domain format and external format.

```typescript
// Internal format (from entity)
interface Order {
  id: OrderId;
  items: OrderItem[];
  total: Money;
  status: OrderStatus;
}

// External format (for API)
interface OrderViewModel {
  id: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPrice: string;
    subtotal: string;
  }>;
  total: string;
  status: string;
  statusDisplay: string;
}
```

## Patterns

### Controller

```typescript
// interfaces/controllers/order-controller.ts
export class OrderController {
  constructor(
    private placeOrderUseCase: PlaceOrderUseCase,
    private getOrderUseCase: GetOrderUseCase,
    private presenter: OrderPresenter,
  ) {}
  
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderViewModel> {
    const request = this.toRequest(input);
    await this.placeOrderUseCase.execute(request);
    return this.presenter.getViewModel();
  }
  
  async getOrder(input: GetOrderInput): Promise<OrderViewModel | null> {
    const request: GetOrderRequest = { orderId: input.orderId };
    await this.getOrderUseCase.execute(request);
    return this.presenter.getOrderViewModel();
  }
  
  private toRequest(input: PlaceOrderInput): PlaceOrderRequest {
    return {
      customerId: input.customerId,
      items: input.items.map(item => ({
        productId: item.productId,
        quantity: Number(item.quantity),
      })),
      shippingAddress: {
        street: input.shippingAddress.street,
        city: input.shippingAddress.city,
        postalCode: input.shippingAddress.postalCode,
        country: input.shippingAddress.country,
      },
    };
  }
}
```

### Presenter

```typescript
// interfaces/presenters/order-presenter.ts
export class OrderPresenter implements PlaceOrderPresenter, GetOrderPresenter {
  private placeOrderViewModel: PlaceOrderViewModel | null = null;
  private orderViewModel: OrderViewModel | null = null;
  private error: ErrorViewModel | null = null;
  
  presentSuccess(response: PlaceOrderResponse): void {
    this.placeOrderViewModel = {
      success: true,
      orderId: response.orderId,
      total: this.formatMoney(response.total),
      estimatedDelivery: this.formatDate(response.estimatedDelivery),
      message: "Your order has been placed successfully!",
    };
  }
  
  presentError(error: UseCaseError): void {
    this.error = {
      success: false,
      code: error.code,
      message: this.getErrorMessage(error),
    };
  }
  
  presentOrder(order: OrderResponse): void {
    this.orderViewModel = {
      id: order.id,
      status: order.status,
      statusDisplay: this.getStatusDisplay(order.status),
      items: order.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: this.formatMoney({ amount: item.unitPrice, currency: "USD" }),
        subtotal: this.formatMoney({ amount: item.subtotal, currency: "USD" }),
      })),
      total: this.formatMoney(order.total),
      placedAt: this.formatDate(order.placedAt),
    };
  }
  
  presentNotFound(orderId: string): void {
    this.error = {
      success: false,
      code: "ORDER_NOT_FOUND",
      message: `Order ${orderId} was not found`,
    };
  }
  
  getViewModel(): PlaceOrderViewModel | ErrorViewModel {
    return this.error ?? this.placeOrderViewModel!;
  }
  
  getOrderViewModel(): OrderViewModel | ErrorViewModel | null {
    return this.error ?? this.orderViewModel;
  }
  
  private formatMoney(money: { amount: number; currency: string }): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: money.currency,
    }).format(money.amount);
  }
  
  private formatDate(isoDate: string): string {
    return new Date(isoDate).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  
  private getStatusDisplay(status: string): string {
    const displays: Record<string, string> = {
      PENDING: "Pending",
      CONFIRMED: "Confirmed",
      SHIPPED: "Shipped",
      DELIVERED: "Delivered",
      CANCELLED: "Cancelled",
    };
    return displays[status] ?? status;
  }
  
  private getErrorMessage(error: UseCaseError): string {
    const messages: Record<string, string> = {
      CUSTOMER_NOT_FOUND: "We couldn't find your account. Please try again.",
      PRODUCT_NOT_FOUND: "One or more products are no longer available.",
      INSUFFICIENT_INVENTORY: "Some items are out of stock.",
    };
    return messages[error.code] ?? "An unexpected error occurred.";
  }
}
```

### Gateway Implementation

```typescript
// interfaces/gateways/sql-order-gateway.ts
export class SqlOrderGateway implements OrderGateway {
  constructor(private db: Database) {}
  
  async findById(id: OrderId): Promise<Order | null> {
    const row = await this.db.query(
      "SELECT * FROM orders WHERE id = ?",
      [id.value],
    );
    
    if (!row) return null;
    
    const items = await this.db.query(
      "SELECT * FROM order_items WHERE order_id = ?",
      [id.value],
    );
    
    return this.toDomain(row, items);
  }
  
  async save(order: Order): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO orders (id, customer_id, status, total_amount, total_currency, placed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = ?, total_amount = ?, total_currency = ?`,
        [
          order.id.value,
          order.customerId.value,
          order.status,
          order.total.amount,
          order.total.currency,
          order.placedAt,
          order.status,
          order.total.amount,
          order.total.currency,
        ],
      );
      
      await tx.query("DELETE FROM order_items WHERE order_id = ?", [order.id.value]);
      
      for (const item of order.items) {
        await tx.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
           VALUES (?, ?, ?, ?)`,
          [order.id.value, item.productId.value, item.quantity, item.unitPrice.amount],
        );
      }
    });
  }
  
  private toDomain(row: OrderRow, items: OrderItemRow[]): Order {
    return new Order(
      OrderId.from(row.id),
      CustomerId.from(row.customer_id),
      items.map(item => new OrderItem(
        ProductId.from(item.product_id),
        Money.of(item.unit_price),
        item.quantity,
      )),
      row.status as OrderStatus,
      new Date(row.placed_at),
    );
  }
}
```

## File Organization

```
interfaces/
├── controllers/
│   ├── order-controller.ts
│   ├── customer-controller.ts
│   └── product-controller.ts
├── presenters/
│   ├── order-presenter.ts
│   ├── customer-presenter.ts
│   └── view-models/
│       ├── order-view-model.ts
│       └── error-view-model.ts
├── gateways/
│   ├── sql-order-gateway.ts
│   ├── sql-customer-gateway.ts
│   └── api-inventory-gateway.ts
└── index.ts
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Controllers | `{Entity}Controller` | `OrderController` |
| Presenters | `{Entity}Presenter` | `OrderPresenter` |
| Gateways | `{Tech}{Entity}Gateway` | `SqlOrderGateway` |
| View Models | `{Entity}ViewModel` | `OrderViewModel` |

## Dependencies

### MAY Import
- Entities (`../entities/`)
- Use Cases (`../use-cases/`)

### MUST NOT Import
- Frameworks (`../frameworks/`)
- Framework-specific libraries (Express, Prisma, etc.)

## Testing

```typescript
describe("OrderController", () => {
  let controller: OrderController;
  let mockUseCase: jest.Mocked<PlaceOrderUseCase>;
  let mockPresenter: jest.Mocked<OrderPresenter>;
  
  beforeEach(() => {
    mockUseCase = createMockUseCase();
    mockPresenter = createMockPresenter();
    controller = new OrderController(mockUseCase, mockPresenter);
  });
  
  it("should convert input to use case request", async () => {
    const input: PlaceOrderInput = {
      customerId: "cust-123",
      items: [{ productId: "prod-1", quantity: "2" }],
      shippingAddress: {
        street: "123 Main St",
        city: "New York",
        postalCode: "10001",
        country: "USA",
      },
    };
    
    await controller.placeOrder(input);
    
    expect(mockUseCase.execute).toHaveBeenCalledWith({
      customerId: "cust-123",
      items: [{ productId: "prod-1", quantity: 2 }],
      shippingAddress: expect.objectContaining({
        city: "New York",
      }),
    });
  });
});

describe("OrderPresenter", () => {
  let presenter: OrderPresenter;
  
  beforeEach(() => {
    presenter = new OrderPresenter();
  });
  
  it("should format money correctly", () => {
    presenter.presentSuccess({
      orderId: "order-123",
      total: { amount: 99.99, currency: "USD" },
      estimatedDelivery: "2024-01-20T00:00:00Z",
    });
    
    const viewModel = presenter.getViewModel();
    expect(viewModel.total).toBe("$99.99");
  });
  
  it("should format error messages for users", () => {
    presenter.presentError({ code: "INSUFFICIENT_INVENTORY", message: "" });
    
    const viewModel = presenter.getViewModel();
    expect(viewModel.message).toBe("Some items are out of stock.");
  });
});
```

