---
name: prisma-transaction
description: Use when writing any Prisma operation that touches more than one row or table that must succeed or fail together — moving/merging tables, placing an order with its items, closing a shift, recording a payment. Trigger on sequential prisma.*.update calls, read-then-write logic, or any operation described as "atomic".
---

# Prisma Transactions

## Overview

Any write that spans more than one row/table and must not be left half-done needs
`prisma.$transaction`. Two awaited calls in a row are **not** atomic — a crash or thrown
error between them leaves the database partially updated (e.g. a table's `tableId` changed
but its unpaid orders didn't move with it).

**Reference implementation:** `lib/server/table-move.ts` (`moveTableSession` /
`mergeTableSessions`) is the canonical example in this codebase — read it before writing a
new multi-step write. It shows every rule below applied together: fresh reads inside the
transaction, an `AuditLog` entry as part of the same commit, and realtime events fired only
*after* the transaction resolves.

## When to Use

- Moving or merging a table session: the session, its orders, the source/target
  `RestaurantTable.status`, and the `AuditLog` entry all commit together or not at all.
- Placing an order, recording a payment, closing a shift — anything creating/updating rows
  across more than one model in one logical action.
- Any case where a later step needs a value from an earlier one (interactive transaction), or
  where a decision depends on a read that must not go stale before the write (read-then-write).

## Core Pattern

Use the **interactive form** (`prisma.$transaction(async (tx) => {...})`) whenever a step
depends on data read earlier in the same flow — which is true for almost every case in this
project, because eligibility checks (is this session still open? already paid? flagged for a
discount?) must be re-read **inside** the transaction, not trusted from what the UI sent:

```ts
const result = await prisma.$transaction(async (tx) => {
  // Read fresh, inside the transaction — the client's request only says intent,
  // not whether it's still true right now.
  const session = await tx.tableSession.findFirst({
    where: { id: sessionId, branchId, status: "OPEN" },
  });
  if (!session) return { ok: false as const, error: "Session no longer open" };

  await tx.order.updateMany({
    where: { tableSessionId: session.id },
    data: { tableId: targetTableId },
  });

  await tx.auditLog.create({
    data: { branchId, staffId, action: "table_session.move", entityType: "table_session", entityId: session.id },
  });

  return { ok: true as const };
});

// Side effects that aren't part of the DB state (realtime announce, etc.)
// happen only after the transaction has committed.
if (result.ok) await announce(branchId, targetTableId);
```

Every call inside the callback must use `tx`, never the top-level `prisma` client — calling
`prisma.x` instead of `tx.x` silently escapes the transaction and breaks atomicity without
raising an error.

Use the **array/batch form** (`prisma.$transaction([op1, op2])`) only when the operations are
genuinely independent of each other's results — it's cheaper but no operation can read
another's output.

## Common Mistakes

| Mistake | Why it's wrong |
|---|---|
| Two separate `await prisma.x.update(...)` calls for a move/merge/payment | Not atomic — a crash between them corrupts state, e.g. a table half-moved or a payment recorded without its order marked paid. |
| Calling `prisma.y.update(...)` (not `tx.y.update(...)`) inside the callback | Runs outside the transaction — silently defeats the whole point. |
| Trusting a client-supplied "this session is still open" instead of re-reading inside `tx` | The client's snapshot can be stale by the time the transaction runs (concurrent staff action) — always re-check inside the transaction, as `loadMovableSession` does in `table-move.ts`. |
| Firing realtime events / side effects *inside* the transaction callback | If the transaction later rolls back, the side effect already happened and can't be undone. Fire them only after `$transaction` resolves successfully (see `announce()` in `table-move.ts`). |
| Doing slow/unrelated I/O (network calls, `fetch`) inside the callback | Holds the DB transaction open, risking Prisma's transaction timeout — keep the callback to DB calls only. |
