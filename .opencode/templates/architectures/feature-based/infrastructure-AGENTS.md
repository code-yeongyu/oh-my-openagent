# Infrastructure Layer Instructions

## Purpose

This directory contains infrastructure concerns that support the features. It provides database configuration, external service clients, application bootstrap, and framework-specific setup.

## Responsibilities

- Database configuration and connections
- External API clients
- Application server setup
- Environment configuration
- Logging and monitoring setup
- Background job configuration
- Cache configuration

## Rules

### 1. Configuration Only
Infrastructure contains configuration and clients, not business logic.

```typescript
// ✅ GOOD: Database configuration
export const db = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query"] : [],
});

// ❌ BAD: Business logic in infrastructure
export async function createOrder(data: OrderData) {
  // Business logic doesn't belong here
  if (data.items.length === 0) throw new Error("Empty order");
  return db.orders.create({ data });
}
```

### 2. Environment-Aware
Infrastructure handles environment-specific configuration.

```typescript
// ✅ GOOD: Environment-aware configuration
export const config = {
  database: {
    url: process.env.DATABASE_URL,
    maxConnections: Number(process.env.DB_MAX_CONNECTIONS) || 10,
  },
  redis: {
    url: process.env.REDIS_URL,
    ttl: Number(process.env.CACHE_TTL) || 3600,
  },
  api: {
    port: Number(process.env.PORT) || 3000,
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  },
};
```

### 3. No Feature Imports
Infrastructure must not import from features.

```typescript
// ✅ GOOD: Generic setup
export function setupRoutes(app: Express): void {
  // Features register their own routes
  app.use("/api", apiRouter);
}

// ❌ BAD: Importing feature code
import { createOrderRoutes } from "@/features/orders/api/routes";
```

### 4. Abstraction for Testing
Provide abstractions that can be mocked in tests.

```typescript
// ✅ GOOD: Abstracted client
export interface StorageClient {
  upload(key: string, data: Buffer): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class S3StorageClient implements StorageClient {
  // S3 implementation
}

export class LocalStorageClient implements StorageClient {
  // Local filesystem for development/testing
}
```

## Structure

```
infrastructure/
├── database/
│   ├── client.ts            # Database client setup
│   ├── migrations/          # Database migrations
│   └── seed.ts              # Database seeding
├── api/
│   ├── client.ts            # HTTP client for external APIs
│   └── middleware.ts        # API middleware
├── cache/
│   ├── client.ts            # Redis/cache client
│   └── keys.ts              # Cache key definitions
├── storage/
│   ├── client.ts            # File storage client
│   └── local.ts             # Local storage for dev
├── queue/
│   ├── client.ts            # Job queue client
│   └── processors.ts        # Job processors registry
├── logging/
│   ├── logger.ts            # Logger configuration
│   └── formatters.ts        # Log formatters
├── server/
│   ├── app.ts               # Express/Fastify app
│   ├── routes.ts            # Route registration
│   └── middleware.ts        # Global middleware
├── config/
│   ├── index.ts             # Environment configuration
│   ├── database.ts          # Database config
│   └── services.ts          # External service config
└── index.ts
```

## Patterns

### Database Client

```typescript
// infrastructure/database/client.ts
import { PrismaClient } from "@prisma/client";
import { config } from "../config";

// Singleton pattern for database client
let prisma: PrismaClient | null = null;

export function getDatabase(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: config.database.url,
        },
      },
      log: config.isDevelopment ? ["query", "warn", "error"] : ["error"],
    });
  }
  return prisma;
}

export async function disconnectDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

// For convenience
export const db = getDatabase();
```

### External API Client

```typescript
// infrastructure/api/client.ts
import axios, { AxiosInstance, AxiosError } from "axios";
import { config } from "../config";
import { logger } from "../logging/logger";

export interface ApiClientOptions {
  baseURL: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export function createApiClient(options: ApiClientOptions): AxiosInstance {
  const client = axios.create({
    baseURL: options.baseURL,
    timeout: options.timeout || 10000,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  
  // Request interceptor
  client.interceptors.request.use(
    (config) => {
      logger.debug("API Request", { url: config.url, method: config.method });
      return config;
    },
    (error) => {
      logger.error("API Request Error", { error: error.message });
      return Promise.reject(error);
    },
  );
  
  // Response interceptor
  client.interceptors.response.use(
    (response) => {
      logger.debug("API Response", { url: response.config.url, status: response.status });
      return response;
    },
    (error: AxiosError) => {
      logger.error("API Response Error", {
        url: error.config?.url,
        status: error.response?.status,
        message: error.message,
      });
      return Promise.reject(error);
    },
  );
  
  return client;
}

// Pre-configured clients for common services
export const paymentApi = createApiClient({
  baseURL: config.services.payment.url,
  headers: { "X-API-Key": config.services.payment.apiKey },
});

export const emailApi = createApiClient({
  baseURL: config.services.email.url,
  headers: { Authorization: `Bearer ${config.services.email.token}` },
});
```

### Cache Client

```typescript
// infrastructure/cache/client.ts
import Redis from "ioredis";
import { config } from "../config";

export interface CacheClient {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

class RedisCacheClient implements CacheClient {
  private redis: Redis;
  
  constructor() {
    this.redis = new Redis(config.redis.url);
  }
  
  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }
  
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.redis.setex(key, ttlSeconds, serialized);
    } else {
      await this.redis.set(key, serialized);
    }
  }
  
  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
  
  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }
}

class MemoryCacheClient implements CacheClient {
  private cache: Map<string, { value: unknown; expiresAt?: number }> = new Map();
  
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value as T;
  }
  
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }
  
  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }
  
  async exists(key: string): Promise<boolean> {
    return this.cache.has(key);
  }
}

export const cache: CacheClient = config.redis.url
  ? new RedisCacheClient()
  : new MemoryCacheClient();
```

### Application Server

```typescript
// infrastructure/server/app.ts
import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "../config";
import { logger, requestLogger } from "../logging/logger";
import { errorHandler } from "./middleware";

export function createApp(): Express {
  const app = express();
  
  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: config.api.corsOrigin,
    credentials: true,
  }));
  
  // Parsing
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  
  // Logging
  app.use(requestLogger);
  
  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  
  return app;
}

export function registerFeatureRoutes(app: Express, routes: Map<string, express.Router>): void {
  routes.forEach((router, path) => {
    app.use(path, router);
    logger.info(`Registered routes for ${path}`);
  });
}

export async function startServer(app: Express): Promise<void> {
  const port = config.api.port;
  
  return new Promise((resolve) => {
    app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
      resolve();
    });
  });
}
```

### Configuration

```typescript
// infrastructure/config/index.ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().transform(Number).default("3000"),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string(),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  
  // External services
  PAYMENT_API_URL: z.string().optional(),
  PAYMENT_API_KEY: z.string().optional(),
  EMAIL_API_URL: z.string().optional(),
  EMAIL_API_TOKEN: z.string().optional(),
});

const env = envSchema.parse(process.env);

export const config = {
  env: env.NODE_ENV,
  isDevelopment: env.NODE_ENV === "development",
  isProduction: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  
  api: {
    port: env.PORT,
    corsOrigin: env.CORS_ORIGIN,
  },
  
  database: {
    url: env.DATABASE_URL,
  },
  
  redis: {
    url: env.REDIS_URL,
  },
  
  auth: {
    jwtSecret: env.JWT_SECRET,
  },
  
  services: {
    payment: {
      url: env.PAYMENT_API_URL,
      apiKey: env.PAYMENT_API_KEY,
    },
    email: {
      url: env.EMAIL_API_URL,
      token: env.EMAIL_API_TOKEN,
    },
  },
};
```

### Logger

```typescript
// infrastructure/logging/logger.ts
import pino from "pino";
import { Request, Response, NextFunction } from "express";
import { config } from "../config";

export const logger = pino({
  level: config.isDevelopment ? "debug" : "info",
  transport: config.isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
        },
      }
    : undefined,
});

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
    });
  });
  
  next();
}
```

## Dependencies

### MAY Import
- Shared (`@/shared/*`) - for common types and utilities

### MUST NOT Import
- Features (`@/features/*`)

## Testing

```typescript
// infrastructure/__tests__/cache.test.ts
import { cache } from "../cache/client";

describe("CacheClient", () => {
  afterEach(async () => {
    await cache.delete("test-key");
  });
  
  it("should set and get value", async () => {
    await cache.set("test-key", { foo: "bar" });
    const value = await cache.get("test-key");
    expect(value).toEqual({ foo: "bar" });
  });
  
  it("should return null for missing key", async () => {
    const value = await cache.get("non-existent");
    expect(value).toBeNull();
  });
  
  it("should respect TTL", async () => {
    await cache.set("test-key", "value", 1); // 1 second TTL
    
    // Should exist immediately
    expect(await cache.exists("test-key")).toBe(true);
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Should be expired
    expect(await cache.get("test-key")).toBeNull();
  });
});
```

