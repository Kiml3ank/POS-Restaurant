---
name: money-calculation
description: Use when writing or reviewing any code that computes, stores, formats, or parses monetary amounts — bill totals, item prices, service charge, VAT, payment amounts, receipts, reports. Trigger on float/Number division for money, a new price/amount field, or code touching more than one branch's currency.
---

# Money Calculation (multi-currency: THB / LAK / VND)

## Overview

This project is **multi-currency per branch** — `Branch.currency` is one of `THB` (Thailand,
2 decimals/satang), `LAK` (Laos, 0 decimals in practice) or `VND` (Vietnam, 0 decimals). The
same integer `6000` in a price column means 60.00 THB, 6,000 LAK, or 6,000 VND depending on
which branch it belongs to. **Never assume THB or VND specifically — always go through the
currency-aware helpers.**

All of this logic already lives in `lib/money.ts`:

- `CURRENCIES: Record<Currency, CurrencyConfig>` — decimals, symbol, symbol position, group/decimal separators, per currency. Adding a currency to the `Currency` enum in `schema.prisma` without adding it here is a `tsc` error by design — don't work around that, add the config.
- `formatMoney(amount, currency)` / `formatAmount(amount, currency)` — the only way to render a stored integer amount for display. Never call `Intl.NumberFormat`/`toLocaleString` directly on a money value (locale mismatch between server and browser causes a hydration flash where the price visibly changes on load).
- `parseMoneyInput(text, currency)` — the only way to turn what a staff member typed into an integer amount. Never do `Number(text) * 100` (documented in the file: `19.99 * 100 === 1998.9999999999998`, silently loses a satang).
- `lineTotalOf(unitPrice, modifierTotal, quantity)` — the one formula for a line total; both the cart and the POS screen must use it so they can't drift apart.

## Rule

**Every monetary value stored, returned from a server action, or passed between functions is
an integer in the branch's minor unit — never a float.** Rates (service charge, VAT, staff
meal discount) are stored on `Branch` as **basis points** (`serviceChargeBp`, `vatRateBp`,
`staffMealDiscountBp` — `1000 = 10.00%`), not as floats/percentages, for the same reason.

Calculation order is fixed: **service charge → VAT**, and `Branch.pricesIncludeVat` decides
whether VAT is added on top or backed out of a VAT-inclusive menu price — check that flag
before writing any new bill-calculation code; don't assume one behavior project-wide.

```ts
// Correct: currency-agnostic, integer-only, uses the shared helpers.
import { lineTotalOf } from "@/lib/money";

const lineTotal = lineTotalOf(item.unitPrice, modifierTotal, item.quantity);
```

```ts
// Wrong: hardcodes a THB assumption and does float math.
const lineTotal = (item.unitPrice / 100 + modifierTotal / 100) * item.quantity; // NaN-adjacent for VND/LAK, and float-lossy for THB
```

## Common Mistakes

| Mistake | Why it's wrong |
|---|---|
| Dividing/multiplying by 100 anywhere outside `lib/money.ts` | Only THB has a minor unit; LAK/VND don't. Hardcoding `/100` breaks non-THB branches silently. |
| Storing a rate as a float (`0.1` for 10%) instead of basis points (`1000`) | Reintroduces float error into every bill calculated with that rate — basis points are exact integers. |
| Computing VAT before service charge, or ignoring `pricesIncludeVat` | Both are branch-configurable and read fresh from `Branch` at calculation time — see the `prisma-transaction` skill for why: settings mid-bill must reflect what's true *now*, but the rate actually charged gets snapshotted onto `Payment` at close-out so historical receipts stay correct even if the branch later changes its rate. |
| Formatting money with `toLocaleString()`/`Intl.NumberFormat` directly | Causes a server/client locale mismatch (hydration flash). Always go through `formatMoney`. |
| `Number(input) * 100` to parse a typed amount | Float precision loss. Use `parseMoneyInput`, which never multiplies a fraction. |
