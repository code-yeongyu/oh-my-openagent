# Frameworks Layer Instructions

## Purpose

This directory contains Frameworks and Drivers. This is the outermost layer where all the details live - the web framework, database, external APIs, UI, and all other external agencies.

## Responsibilities

- Web framework configuration (Express, Fastify, Hono)
- Database setup and connections (Prisma, TypeORM)
- HTTP route definitions
- Middleware configuration
- External API clients
- Dependency injection container
- Application bootstrap

## Rules

### 1. Glue Code Only
This layer contains glue code that connects external tools to the inner layers.

```typescript
// ✅ GOOD: Glue code connecting framework to controller
app.post("/orders", async (req: Request, res: Response) => {
  const controller = container.get(OrderController);
  const presenter = container.get(OrderPresenter);
  
  const viewModel = await controller.placeOrder(req.body);
  
  res.status(viewModel.success ? 201 : 400).json(viewModel);
});
```

### 2. All Details Live Here
Framework-specific code is isolated to this layer.

```typescript
// ✅ GOOD: Framework details contained
import express from "express";
import { PrismaClient } from "@prisma/client";
import cors from "cors";

export function createApp(): Express {
  const app = express();
  
  app.use(cors());
  app.use(express.json());
  app.use(authMiddleware);
  
  // Register routes
  registerOrderRoutes(app);
  registerCustomerRoutes(app);
  
  return app;
}
```

### 3. Dependency Injection
Wire up all dependencies here.

```typescript
// ✅ GOOD: DI container setup
export function createContainer(): Container {
  const container = new Container();
  
  // Infrastructure
  container.bind(PrismaClient).toSelf().inSingletonScope();
  
  // Gateways
  container.bind<OrderGateway>(TYPES.OrderGateway)
    .to(PrismaOrderGateway);
  container.bind<CustomerGateway>(TYPES.CustomerGateway)
    .to(PrismaCustomerGateway);
  
  // Use Cases
  container.bind(PlaceOrderUseCase).toSelf();
  container.bind(GetOrderUseCase).toSelf();
  
  // Controllers
  container.bind(OrderController).toSelf();
  
  // Presenters
  container.bind(OrderPresenter).toSelf();
  
  return container;
}
```

### 4. Keep It Thin
The frameworks layer should have minimal code - mostly configuration and wiring.

## Patterns

### Application Bootstrap

```typescript
// frameworks/app.ts
import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { Container } from "inversify";
import { createContainer } from "./container";
import { registerRoutes } from "./routes";
import { errorHandler } from "./middleware/error-handler";

export class Application {
  private app: Express;
  private container: Container;
  
  constructor() {
    this.app = express();
    this.container = createContainer();
    this.configureMiddleware();
    this.registerRoutes();
    this.configureErrorHandling();
  }
  
  private configureMiddleware(): void {
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN,
      credentials: true,
    }));
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true }));
  }
  
  private registerRoutes(): void {
    registerRoutes(this.app, this.container);
  }
  
  private configureErrorHandling(): void {
    this.app.use(errorHandler);
  }
  
  async start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(port, () => {
        console.log(`Server running on port ${port}`);
        resolve();
      });
    });
  }
}

// frameworks/main.ts
async function main() {
  const app = new Application();
  await app.start(Number(process.env.PORT) || 3000);
}

main().catch(console.error);
```

### Route Registration

```typescript
// frameworks/routes/order-routes.ts
import { Router, Request, Response } from "express";
import { Container } from "inversify";
import { OrderController } from "../../interfaces/controllers/order-controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { placeOrderSchema } from "../schemas/order-schemas";

export function registerOrderRoutes(router: Router, container: Container): void {
  const controller = container.get(OrderController);
  
  router.post(
    "/orders",
    authenticate,
    validate(placeOrderSchema),
    async (req: Request, res: Response) => {
      try {
        const viewModel = await controller.placeOrder(req.body);
        res.status(viewModel.success ? 201 : 400).json(viewModel);
      } catch (error) {
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );
  
  router.get(
    "/orders/:id",
    authenticate,
    async (req: Request, res: Response) => {
      const viewModel = await controller.getOrder({ orderId: req.params.id });
      
      if (!viewModel) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      res.json(viewModel);
    },
  );
  
  router.get(
    "/orders",
    authenticate,
    async (req: Request, res: Response) => {
      const viewModel = await controller.listOrders({
        customerId: req.query.customerId as string,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
      });
      res.json(viewModel);
    },
  );
}
```

### Dependency Injection Container

```typescript
// frameworks/container.ts
import { Container } from "inversify";
import { PrismaClient } from "@prisma/client";

// Import types
import { TYPES } from "./types";

// Import interfaces (gateways)
import { OrderGateway } from "../use-cases/gateways/order-gateway";
import { CustomerGateway } from "../use-cases/gateways/customer-gateway";
import { InventoryGateway } from "../use-cases/gateways/inventory-gateway";

// Import implementations
import { PrismaOrderGateway } from "./database/prisma-order-gateway";
import { PrismaCustomerGateway } from "./database/prisma-customer-gateway";
import { ApiInventoryGateway } from "./external/api-inventory-gateway";

// Import use cases
import { PlaceOrderUseCase } from "../use-cases/place-order/place-order-use-case";
import { GetOrderUseCase } from "../use-cases/get-order/get-order-use-case";

// Import interface adapters
import { OrderController } from "../interfaces/controllers/order-controller";
import { OrderPresenter } from "../interfaces/presenters/order-presenter";

export const TYPES = {
  // Gateways
  OrderGateway: Symbol.for("OrderGateway"),
  CustomerGateway: Symbol.for("CustomerGateway"),
  InventoryGateway: Symbol.for("InventoryGateway"),
  
  // External
  PrismaClient: Symbol.for("PrismaClient"),
};

export function createContainer(): Container {
  const container = new Container();
  
  // ========================================
  // Infrastructure
  // ========================================
  
  const prisma = new PrismaClient();
  container.bind(TYPES.PrismaClient).toConstantValue(prisma);
  
  // ========================================
  // Gateways (Port implementations)
  // ========================================
  
  container.bind<OrderGateway>(TYPES.OrderGateway)
    .to(PrismaOrderGateway)
    .inSingletonScope();
    
  container.bind<CustomerGateway>(TYPES.CustomerGateway)
    .to(PrismaCustomerGateway)
    .inSingletonScope();
    
  container.bind<InventoryGateway>(TYPES.InventoryGateway)
    .to(ApiInventoryGateway)
    .inSingletonScope();
  
  // ========================================
  // Use Cases
  // ========================================
  
  container.bind(PlaceOrderUseCase).toSelf();
  container.bind(GetOrderUseCase).toSelf();
  
  // ========================================
  // Interface Adapters
  // ========================================
  
  container.bind(OrderController).toSelf();
  container.bind(OrderPresenter).toSelf();
  
  return container;
}
```

### Database Gateway Implementation

```typescript
// frameworks/database/prisma-order-gateway.ts
import { injectable, inject } from "inversify";
import { PrismaClient } from "@prisma/client";
import { OrderGateway } from "../../use-cases/gateways/order-gateway";
import { Order, OrderId, CustomerId, OrderItem, Money } from "../../entities";
import { TYPES } from "../types";

@injectable()
export class PrismaOrderGateway implements OrderGateway {
  constructor(
    @inject(TYPES.PrismaClient) private prisma: PrismaClient,
  ) {}
  
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
      create: {
        id: order.id.value,
        customerId: order.customerId.value,
        status: order.status,
        totalAmount: order.total.amount,
        totalCurrency: order.total.currency,
        placedAt: order.placedAt,
        items: {
          create: order.items.map(item => ({
            productId: item.productId.value,
            quantity: item.quantity,
            unitPrice: item.unitPrice.amount,
          })),
        },
      },
      update: {
        status: order.status,
        totalAmount: order.total.amount,
        items: {
          deleteMany: {},
          create: order.items.map(item => ({
            productId: item.productId.value,
            quantity: item.quantity,
            unitPrice: item.unitPrice.amount,
          })),
        },
      },
    });
  }
  
  async delete(id: OrderId): Promise<void> {
    await this.prisma.order.delete({
      where: { id: id.value },
    });
  }
  
  private toDomain(record: any): Order {
    return new Order(
      OrderId.from(record.id),
      CustomerId.from(record.customerId),
      record.items.map((item: any) => new OrderItem(
        ProductId.from(item.productId),
        Money.of(Number(item.unitPrice)),
        item.quantity,
      )),
      record.status,
      record.placedAt,
    );
  }
}
```

### Middleware

```typescript
// frameworks/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace("Bearer ", "");
  
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// frameworks/middleware/error-handler.ts
import { Request, Response, NextFunction } from "express";

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  console.error(error);
  
  if (error.name === "ValidationError") {
    res.status(400).json({ error: error.message });
    return;
  }
  
  res.status(500).json({ error: "Internal server error" });
}
```

## File Organization

```
frameworks/
├── app.ts                    # Express app setup
├── main.ts                   # Application entry point
├── container.ts              # DI container configuration
├── types.ts                  # DI symbols/tokens
├── routes/
│   ├── index.ts              # Route registration
│   ├── order-routes.ts
│   └── customer-routes.ts
├── middleware/
│   ├── auth.ts
│   ├── validate.ts
│   └── error-handler.ts
├── schemas/
│   ├── order-schemas.ts      # Zod/Yup validation schemas
│   └── customer-schemas.ts
├── database/
│   ├── prisma-order-gateway.ts
│   ├── prisma-customer-gateway.ts
│   └── migrations/
├── external/
│   ├── api-inventory-gateway.ts
│   └── stripe-payment-gateway.ts
└── config/
    ├── database.ts
    └── environment.ts
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| App Configuration | `app.ts` | `app.ts` |
| Route Files | `{entity}-routes.ts` | `order-routes.ts` |
| Middleware | `{purpose}.ts` | `auth.ts` |
| Gateway Implementations | `{tech}-{entity}-gateway.ts` | `prisma-order-gateway.ts` |
| Schema Files | `{entity}-schemas.ts` | `order-schemas.ts` |

## Dependencies

### MAY Import
- Entities (`../entities/`)
- Use Cases (`../use-cases/`)
- Interfaces (`../interfaces/`)
- All external libraries and frameworks

### External Libraries
This is the only layer that directly uses:
- Express, Fastify, Hono (web frameworks)
- Prisma, TypeORM, Drizzle (ORMs)
- Zod, Yup (validation)
- JWT, bcrypt (security)
- Axios, node-fetch (HTTP clients)

## Testing

### Integration Tests

```typescript
// frameworks/__tests__/order-routes.test.ts
import request from "supertest";
import { Application } from "../app";
import { createTestContainer } from "./test-helpers";

describe("Order Routes", () => {
  let app: Application;
  let authToken: string;
  
  beforeAll(async () => {
    app = new Application(createTestContainer());
    authToken = await createTestToken();
  });
  
  afterAll(async () => {
    await app.close();
  });
  
  describe("POST /orders", () => {
    it("should create order and return 201", async () => {
      const response = await request(app.express)
        .post("/orders")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          customerId: "cust-123",
          items: [{ productId: "prod-1", quantity: 2 }],
          shippingAddress: {
            street: "123 Main St",
            city: "New York",
            postalCode: "10001",
            country: "USA",
          },
        });
      
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        success: true,
        orderId: expect.any(String),
      });
    });
    
    it("should return 401 without auth token", async () => {
      const response = await request(app.express)
        .post("/orders")
        .send({});
      
      expect(response.status).toBe(401);
    });
  });
});
```

### E2E Tests

```typescript
describe("Order Flow E2E", () => {
  it("should complete full order flow", async () => {
    // 1. Create order
    const createResponse = await request(app)
      .post("/orders")
      .set("Authorization", `Bearer ${token}`)
      .send(orderData);
    
    const { orderId } = createResponse.body;
    
    // 2. Get order
    const getResponse = await request(app)
      .get(`/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`);
    
    expect(getResponse.body.status).toBe("PENDING");
    
    // 3. Confirm order
    await request(app)
      .post(`/orders/${orderId}/confirm`)
      .set("Authorization", `Bearer ${token}`);
    
    // 4. Verify status updated
    const finalResponse = await request(app)
      .get(`/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`);
    
    expect(finalResponse.body.status).toBe("CONFIRMED");
  });
});
```

