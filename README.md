# Backend Playground 2 — Orders API

NestJS + PostgreSQL project implementing transactional order creation with idempotency, concurrency protection, and SQL optimization.

## Setup

```bash
npm install
cp .env.example .env.dev   # adjust DB credentials if needed

# Run migrations
NODE_ENV=dev npm run migration:run

# Seed data
NODE_ENV=dev npm run seed

# Start the server
NODE_ENV=dev npm run start:dev
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/orders` | List orders (filterable by status, userId, date range) |
| `POST` | `/orders` | Create order (requires `Idempotency-Key` header) |
| `GET` | `/products` | List all products |
| `GET` | `/users` | List all users |
| `GET` | `/users/:id` | Get user by UUID |

---

## Homework 05 — Technical Decisions

### 1. Transaction Implementation

All order creation logic runs inside a single **QueryRunner transaction** (`orders.service.ts`):

1. `queryRunner.startTransaction()`
2. Create `Order` row (with `idempotencyKey`)
3. Lock product rows (`SELECT ... FOR UPDATE`)
4. Decrement stock atomically (`UPDATE ... WHERE stock >= $1`)
5. Create `OrderItem` rows
6. `commitTransaction()` — or `rollbackTransaction()` on any error
7. `release()` in `finally` block — always

If any step fails, the entire transaction is rolled back. No partial writes are possible.

### 2. Concurrency Mechanism — Pessimistic Locking

**Choice: pessimistic locking (`SELECT ... FOR UPDATE`)**

Why pessimistic over optimistic:

- **Order creation is a write-heavy, conflict-prone operation.** When multiple users order the same product simultaneously, conflicts are expected — not rare. Optimistic locking would lead to frequent retries, adding latency and complexity.
- **Pessimistic locking guarantees correctness in a single round-trip.** The product row is locked for the duration of the transaction, so no other transaction can read stale stock values.
- **Simpler code.** No need for version columns, retry loops, or backoff logic.

Flow:
1. Lock all requested product rows with `lock: { mode: 'pessimistic_write' }` (translates to `SELECT ... FOR UPDATE`)
2. Atomically decrement stock: `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`
3. Check affected rows — if 0, throw `BadRequestException` with details about which product has insufficient stock

This prevents overselling even under high concurrency: if two transactions try to buy the last item, one will wait for the other's lock to release, then see the updated (zero) stock and fail gracefully.

### 3. Idempotency

Two layers of protection:

#### Layer 1 — `IdempotencyInterceptor` (application-level cache)

- Client must send `Idempotency-Key: <uuid>` header with every `POST /orders` request.
- On first request: interceptor creates a `processing` record in the `idempotency` table, passes through to the handler, then saves the full response (`statusCode` + `body`) as `completed`.
- On repeated request with same key: interceptor finds the `completed` record and returns the cached response immediately — the handler is never called.
- If a concurrent request arrives while the first is still processing: returns `409 Conflict`.

#### Layer 2 — `orders.idempotency_key` UNIQUE constraint (race-condition safety net)

- Even if two concurrent requests bypass the interceptor check simultaneously, the `UNIQUE` constraint on `orders.idempotency_key` catches the duplicate.
- The `catch` block detects PostgreSQL error `23505` on `idempotency_key`, fetches the existing order, and returns it.

### 4. Error Handling

| Scenario | HTTP Status | Behavior |
|----------|-------------|----------|
| Insufficient stock | `400 Bad Request` | Message includes product title, available stock, and requested quantity |
| Duplicate idempotency key (cached) | Original status (200/201) | Returns cached response from first request |
| Duplicate idempotency key (race) | 200/201 | Fetches and returns existing order |
| Concurrent processing of same key | `409 Conflict` | "Request is already being processed" |
| Missing `Idempotency-Key` header | `400 Bad Request` | "Idempotency-Key header is required" |
| Any other error | `500` | Transaction rolled back, error propagated |

---

## SQL Optimization

### Hot Query

The `GET /orders` endpoint with filters — used for listing a user's orders by status within a date range:

```sql
SELECT o.id, o.user_id, o.status, o.created_at,
       oi.product_id, oi.quantity
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
WHERE o.user_id = ?
  AND o.status = 'CREATED'
  AND o.created_at >= '2026-01-01'
  AND o.created_at <= '2026-02-01'
ORDER BY o.created_at DESC
LIMIT 20 OFFSET 0;
```

### Before Optimization

Existing single-column indexes: `IDX_orders_user_id` and `IDX_orders_created_at`.

The planner cannot satisfy all three WHERE conditions + ORDER BY with a single index. It uses BitmapAnd of two separate indexes → Bitmap Heap Scan → Sort.

**EXPLAIN ANALYZE (without composite index):**

```
 Limit  (cost=25.33..25.34 rows=1 width=64) (actual time=0.065..0.067 rows=2 loops=1)
   Buffers: shared hit=8
   ->  Sort  (cost=25.33..25.34 rows=1 width=64) (actual time=0.064..0.066 rows=2 loops=1)
         Sort Key: o.created_at DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=8
         ->  Nested Loop Left Join  (cost=12.80..25.32 rows=1 width=64) (actual time=0.033..0.035 rows=2 loops=1)
               Buffers: shared hit=5
               ->  Bitmap Heap Scan on orders o  (cost=8.62..12.64 rows=1 width=44) (actual time=0.023..0.024 rows=1 loops=1)
                     Recheck Cond: (user_id = '...' AND created_at >= '...' AND created_at <= '...')
                     Filter: (status = 'CREATED'::orders_status_enum)
                     Heap Blocks: exact=1
                     Buffers: shared hit=3
                     ->  BitmapAnd  (cost=8.62..8.62 rows=1 width=0) (actual time=0.010..0.011 rows=0 loops=1)
                           Buffers: shared hit=2
                           ->  Bitmap Index Scan on "IDX_orders_user_id"  (cost=0.00..4.18 rows=4 width=0) (actual time=0.007..0.007 rows=1 loops=1)
                                 Index Cond: (user_id = '...')
                                 Buffers: shared hit=1
                           ->  Bitmap Index Scan on "IDX_orders_created_at"  (cost=0.00..4.19 rows=4 width=0) (actual time=0.002..0.002 rows=2 loops=1)
                                 Index Cond: (created_at >= '...' AND created_at <= '...')
                                 Buffers: shared hit=1
               ->  Bitmap Heap Scan on order_items oi  (cost=4.18..12.64 rows=4 width=36) (actual time=0.007..0.007 rows=2 loops=1)
                     Recheck Cond: (order_id = o.id)
                     Heap Blocks: exact=1
                     Buffers: shared hit=2
                     ->  Bitmap Index Scan on "IDX_order_items_order_id"  (cost=0.00..4.18 rows=4 width=0) (actual time=0.002..0.002 rows=2 loops=1)
                           Index Cond: (order_id = o.id)
                           Buffers: shared hit=1
 Planning Time: 1.314 ms
 Execution Time: 0.361 ms
```

Key issues: planner uses **BitmapAnd** of two single-column indexes, then applies a **Filter** for `status` (not covered by any index), and adds an explicit **Sort** step (quicksort) for `ORDER BY created_at DESC`. Total **8 shared buffer hits**.

### Optimization — Composite Index

```sql
CREATE INDEX "IDX_orders_user_status_created"
  ON "orders" ("user_id", "status", "created_at" DESC);
```

Added via migration `1700000003000-add-orders-composite-index.ts`.

### After Optimization

**EXPLAIN ANALYZE (with composite index):**

```
 Limit  (cost=0.13..2.03 rows=20 width=64) (actual time=0.203..0.206 rows=2 loops=1)
   Buffers: shared hit=2 read=1
   ->  Nested Loop Left Join  (cost=0.13..34.35 rows=360 width=64) (actual time=0.202..0.204 rows=2 loops=1)
         Join Filter: (oi.order_id = o.id)
         Buffers: shared hit=2 read=1
         ->  Index Scan using "IDX_orders_user_status_created" on orders o  (cost=0.13..8.15 rows=1 width=44) (actual time=0.192..0.193 rows=1 loops=1)
               Index Cond: (user_id = '...' AND status = 'CREATED'
                            AND created_at >= '...' AND created_at <= '...')
               Buffers: shared hit=1 read=1
         ->  Seq Scan on order_items oi  (cost=0.00..17.20 rows=720 width=36) (actual time=0.008..0.008 rows=4 loops=1)
               Buffers: shared hit=1
 Planning Time: 1.618 ms
 Execution Time: 0.253 ms
```

### Why This Is Better

1. **Single index covers all WHERE conditions + ORDER BY.** The planner switched from BitmapAnd + Sort to a single **Index Scan** on `IDX_orders_user_status_created`. All three filter conditions (`user_id`, `status`, `created_at` range) are now in the `Index Cond` — no post-scan `Filter` step needed.
2. **Sort step eliminated.** Because `created_at DESC` is part of the index, rows come out already in the correct order — the explicit quicksort from the "before" plan is gone entirely.
3. **LIMIT 20 benefits from early termination.** With the sorted index scan, PostgreSQL stops after finding 20 matching rows instead of materializing + sorting the entire result set.
4. **Column order matters.** `(user_id, status, created_at)` follows the equality-first, range-last principle: `user_id` and `status` are equality conditions (high selectivity), `created_at` is the range + sort column.

### Conclusion

The composite index transformed the plan from **BitmapAnd (2 indexes) → Bitmap Heap Scan → Filter → Sort** into a single **Index Scan** with no filtering or sorting overhead. Execution time dropped from 0.361 ms to 0.253 ms. On larger datasets with thousands of orders per user, the difference would be much more dramatic because the Sort step scales with the number of matching rows, whereas the index scan + LIMIT only needs to touch the first N matching entries.

### EXPLAIN scripts

- `scripts/explain-before.sql` — run before migration to capture the plan without the composite index
- `scripts/explain-after.sql` — run after migration to capture the plan with the composite index

---

## Migrations

| Migration | What it does |
|-----------|-------------|
| `1700000000000-init` | Creates `users`, `products`, `orders`, `order_items` tables + FKs + basic indexes |
| `1700000001000-add-order-status-product-active` | Adds `status` enum to orders, `is_active` to products, `IDX_orders_created_at` |
| `1700000002000-add-stock-idempotency` | Adds `stock` to products, `idempotency_key` (UNIQUE) to orders, `idempotency` table |
| `1700000003000-add-orders-composite-index` | Adds composite index `(user_id, status, created_at DESC)` for the hot query |

## Testing Concurrency

```bash
# Run the concurrency test (sends 30 parallel order requests)
npx tsx scripts/concurrency-test.ts
```

The test sends 30 simultaneous `POST /orders` requests, each with a unique `Idempotency-Key`. Expected result: only requests where stock is available succeed; the rest get `400` (insufficient stock).
