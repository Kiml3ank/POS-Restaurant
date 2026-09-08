---
name: multi-tenant-schema
description: Use when adding a new Prisma model to schema.prisma, or writing any query that reads/writes restaurant-scoped data (tables, orders, menu items, staff, sessions). Trigger on a new `model` block, a findUnique/findFirst/update by bare id, or any route/query touching data that belongs to one branch.
---

# Multi-Tenant Schema Safety

## Overview

The tenancy model is two levels: `Tenant` (a business, can own multiple locations) →
`Branch` (one restaurant location — tables, orders, menu, staff, shifts all belong to a
branch). **Every restaurant-owned table is scoped by `branchId`, not `tenantId`** — `tenantId`
only lives on `Branch` itself (`@@unique([tenantId, code])`). A missing or unenforced
`branchId` filter is a cross-branch data leak: branch A's staff session could read or modify
branch B's tables, orders, or menu just by guessing/passing an id.

## When to Use

- Adding a new `model` in `prisma/schema.prisma` that stores data belonging to one branch.
- Writing a query or server action that fetches or mutates a record by `id`.
- Reviewing a route/action for whether it trusts a client-supplied id without scoping it.

## Core Rule

1. Every branch-scoped model gets a required `branchId String` field **in its first
   migration**, a relation to `Branch`, and `@@index([branchId])` (or a compound index
   leading with `branchId` if the model is commonly queried per-branch plus another filter,
   e.g. `@@index([branchId, status])`).
2. Every query against a branch-scoped model filters by `branchId` — sourced from the
   **authenticated staff session**, never from client-supplied input alone.

```prisma
// Real pattern from schema.prisma (Station model)
model Station {
  id       String @id @default(cuid())
  branchId String
  code     String
  // ...
  branch Branch @relation(fields: [branchId], references: [id], onDelete: Cascade)

  @@unique([branchId, code])
  @@index([branchId])
}
```

```ts
// Wrong: trusts the id alone — another branch's id could be passed in.
const table = await prisma.restaurantTable.findUnique({ where: { id: tableId } });

// Right: scoped to the branch from the authenticated staff session.
const table = await prisma.restaurantTable.findFirst({
  where: { id: tableId, branchId: staff.branchId },
});
```

## Common Mistakes

| Mistake | Why it's wrong |
|---|---|
| Adding a branch-scoped model without `branchId` "for now, add it later" | Retrofitting `branchId` onto an existing populated table means every existing query is a silent leak until audited. |
| Using `findUnique({ where: { id } })` for branch-scoped data | `findUnique` can't take a compound filter unless it's a declared unique constraint — use `findFirst` with both `id` and `branchId` in `where`. |
| Deriving `branchId` from the request body/query string instead of the session | A client could simply pass a different branch's id. Always source it from the authenticated staff session (see `CurrentStaff` in `lib/server/staff-session.ts`), then thread it explicitly into every Prisma call in that request. |
| Scoping by `tenantId` on a restaurant-owned table | Wrong level — a `Tenant` can have multiple `Branch`es, and tables/orders/menu belong to one specific branch, not the whole tenant. Use `branchId`. |
| Re-checking eligibility (e.g. "is this session still open") from data read *before* a transaction, instead of inside it | Not a tenancy bug per se, but the same "don't trust a stale/client value" principle — see the `prisma-transaction` skill. |
