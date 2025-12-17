# Shared Layer Instructions

## Purpose

This directory contains code that is shared across multiple features. It provides common utilities, components, types, and cross-cutting concerns that don't belong to any specific feature.

## Responsibilities

- Common UI components (Button, Modal, Form elements)
- Shared utility functions (formatters, validators, helpers)
- Common types and interfaces
- Cross-cutting concerns (authentication, logging, error handling)
- Event bus for inter-feature communication
- Shared hooks and contexts

## Rules

### 1. Feature-Agnostic
Shared code must not know about or depend on any feature.

```typescript
// ✅ GOOD: Generic, reusable component
export function Button({ children, onClick, variant = "primary" }: ButtonProps) {
  return (
    <button className={`btn btn-${variant}`} onClick={onClick}>
      {children}
    </button>
  );
}

// ❌ BAD: Feature-specific component
export function OrderButton({ order }: { order: Order }) {
  // This belongs in features/orders/components/
}
```

### 2. Stable API
Shared code should have a stable API since many features depend on it.

```typescript
// ✅ GOOD: Stable, well-defined interface
export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginate<T>(items: T[], options: PaginationOptions): PaginatedResult<T> {
  // Implementation
}
```

### 3. No External Feature Imports
The shared layer must never import from features.

```typescript
// ✅ GOOD: No feature imports
import { config } from "@/infrastructure/config";

// ❌ BAD: Importing from feature
import { OrderType } from "@/features/orders/models";
```

### 4. Minimal Dependencies
Keep the shared layer lean with minimal external dependencies.

## Structure

```
shared/
├── components/          # Reusable UI components
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx
│   │   └── index.ts
│   ├── Modal/
│   ├── Form/
│   └── index.ts
├── hooks/               # Shared React hooks
│   ├── useAsync.ts
│   ├── useLocalStorage.ts
│   └── index.ts
├── utils/               # Utility functions
│   ├── formatters.ts
│   ├── validators.ts
│   ├── date.ts
│   └── index.ts
├── types/               # Common type definitions
│   ├── api.ts
│   ├── common.ts
│   └── index.ts
├── events/              # Event bus for inter-feature communication
│   ├── event-bus.ts
│   └── index.ts
├── context/             # React contexts
│   ├── AuthContext.tsx
│   └── ThemeContext.tsx
├── middleware/          # Shared middleware
│   ├── auth.ts
│   └── error-handler.ts
├── constants/           # Shared constants
│   └── index.ts
└── index.ts             # Main export
```

## Patterns

### Utility Functions

```typescript
// shared/utils/formatters.ts
export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

export function formatDate(date: Date | string, format = "medium"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  
  const formats: Record<string, Intl.DateTimeFormatOptions> = {
    short: { month: "short", day: "numeric" },
    medium: { month: "short", day: "numeric", year: "numeric" },
    long: { weekday: "long", month: "long", day: "numeric", year: "numeric" },
    time: { hour: "numeric", minute: "2-digit" },
    datetime: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  };
  
  return new Intl.DateTimeFormat("en-US", formats[format]).format(d);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}
```

### Reusable Components

```typescript
// shared/components/Button/Button.tsx
import { ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = "primary", size = "md", isLoading, className, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          "btn",
          `btn-${variant}`,
          `btn-${size}`,
          isLoading && "btn-loading",
          className,
        )}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? <Spinner size="sm" /> : children}
      </button>
    );
  },
);

Button.displayName = "Button";
```

### Event Bus

```typescript
// shared/events/event-bus.ts
type EventCallback<T = unknown> = (data: T) => void | Promise<void>;

class EventBus {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  
  on<T>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback);
    
    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback);
    };
  }
  
  emit<T>(event: string, data: T): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }
  
  off(event: string, callback?: EventCallback): void {
    if (callback) {
      this.listeners.get(event)?.delete(callback);
    } else {
      this.listeners.delete(event);
    }
  }
}

export const eventBus = new EventBus();

// Type-safe event definitions
export interface AppEvents {
  "order:created": { orderId: string; customerId: string };
  "order:completed": { orderId: string };
  "user:logged-in": { userId: string };
  "user:logged-out": { userId: string };
}

// Type-safe emit/on helpers
export function emitEvent<K extends keyof AppEvents>(
  event: K,
  data: AppEvents[K],
): void {
  eventBus.emit(event, data);
}

export function onEvent<K extends keyof AppEvents>(
  event: K,
  callback: (data: AppEvents[K]) => void,
): () => void {
  return eventBus.on(event, callback);
}
```

### Shared Hooks

```typescript
// shared/hooks/useAsync.ts
import { useState, useCallback } from "react";

interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
}

export function useAsync<T, Args extends unknown[]>(
  asyncFn: (...args: Args) => Promise<T>,
) {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    isLoading: false,
  });
  
  const execute = useCallback(
    async (...args: Args) => {
      setState({ data: null, error: null, isLoading: true });
      
      try {
        const data = await asyncFn(...args);
        setState({ data, error: null, isLoading: false });
        return data;
      } catch (error) {
        setState({ data: null, error: error as Error, isLoading: false });
        throw error;
      }
    },
    [asyncFn],
  );
  
  return { ...state, execute };
}

// shared/hooks/useLocalStorage.ts
import { useState, useEffect } from "react";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });
  
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      console.error("Error saving to localStorage:", error);
    }
  }, [key, storedValue]);
  
  return [storedValue, setStoredValue] as const;
}
```

### Shared Types

```typescript
// shared/types/api.ts
export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// shared/types/common.ts
export type Status = "pending" | "active" | "completed" | "cancelled";

export interface Identifiable {
  id: string;
}

export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

export interface BaseEntity extends Identifiable, Timestamps {}
```

### Auth Context

```typescript
// shared/context/AuthContext.tsx
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    // Check for existing session
    checkAuth();
  }, []);
  
  async function checkAuth() {
    try {
      const response = await fetch("/api/auth/me");
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      }
    } finally {
      setIsLoading(false);
    }
  }
  
  async function login(email: string, password: string) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    
    if (!response.ok) {
      throw new Error("Login failed");
    }
    
    const data = await response.json();
    setUser(data.user);
  }
  
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }
  
  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
```

## Dependencies

### MAY Import
- Nothing internal (shared is the base layer)
- External utility libraries (date-fns, lodash, etc.)

### MUST NOT Import
- Features (`@/features/*`)
- Infrastructure (`@/infrastructure/*`) - if needed, pass as dependency

## Testing

```typescript
// shared/utils/__tests__/formatters.test.ts
import { formatCurrency, formatDate } from "../formatters";

describe("formatters", () => {
  describe("formatCurrency", () => {
    it("should format USD by default", () => {
      expect(formatCurrency(100)).toBe("$100.00");
      expect(formatCurrency(1234.56)).toBe("$1,234.56");
    });
    
    it("should format other currencies", () => {
      expect(formatCurrency(100, "EUR")).toBe("€100.00");
    });
  });
  
  describe("formatDate", () => {
    const date = new Date("2024-01-15");
    
    it("should format with medium format by default", () => {
      expect(formatDate(date)).toBe("Jan 15, 2024");
    });
    
    it("should handle string dates", () => {
      expect(formatDate("2024-01-15")).toBe("Jan 15, 2024");
    });
  });
});
```

