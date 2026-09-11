# i18n vi/en + VND — handoff (2026-09-11)

Supersedes `2026-09-09-i18n-vnd-progress.md`. Branch `feat/i18n-vi-en-vnd`.
Plan: `2026-09-09-plan-i18n-vnd-tasks.md` · Spec: `2026-09-09-plan-i18n-vnd-design.md`

## Status: Tasks 1–10 done · Task 11 in progress (Step 1 almost done)

| Commit | Task |
|---|---|
| `cbb8f29` `6143018` `82ffb67` | 1–3 core, plumbing, actions return keys |
| `52aa21d` | 4 label modules → key builders |
| `d86ef57` | 5 customer screens |
| `5c44ca5` | 6 KDS |
| `f02ceb4` | dev:session fix (was creating a 2nd OPEN session) |
| `c3c7b6a` | 7 POS |
| `e3e3e0f` | 8 admin |
| `ae00e5e` | 9 VND seed (Nhà hàng Sen Vàng, Asia/Ho_Chi_Minh, VAT 8% exclusive, SC 5%) |
| `407456e` | 10 smoke asserts keys + VND totals |

`wip/i18n-task4` is fully superseded (cherry-picked) — safe to delete at the end.

## Verified numbers (this session, prod build on :3002)

- **Smoke: 16 sets · 849 PASS · 0 FAIL** — order 32 · pos 58 · kds 55 · bill 48 ·
  payment 67 · menu 55 · receipt 82 · staff-meal 80 · takeaway 86 · staff-session 35 ·
  staff-admin 45 · settings 40 · dashboard 31 · table-move 63 · tables 49 · i18n 23
- `tsc --noEmit` clean · `eslint scripts` clean · `npm run build` passes
- **audit:screens, both locales (5 viewports each):**
  customer 40/40 · KDS 20/20 · login pages + `/` 40/40 · admin 120/120 ·
  **POS 68/80 — the 12 FAILs are a known config false alarm, not layout bugs:**
  `/pos/table/seed-table-a1` and `/pos/counter/<id>` at 390/768/1024 report
  "Cart total"/"Send 2 items to kitchen" as hidden. Below `xl` the cart is the
  collapsed summary bar (by design, CLAUDE.md "responsive" section), so those labels are
  0×0. **To close it:** for those two pages use a `mustSee` that exists in the
  collapsed bar (the item-count text), or audit the cart labels at ≥1280 only
  (`AUDIT_VIEWPORTS`). The same false alarm was hit and resolved this way in Task 7.

## Task 10 — what changed and why (for the report)

- Expected money is **derived**, never transcribed: DB `basePrice` + modifier
  `priceDelta`, then `calculateBill()` with the branch's live rates.
  - bill: round subtotals from DB prices · takeaway: counter total =
    `calculateBill({serviceChargeBp: 0, vat, pricesIncludeVat})` (the old
    "grandTotal = subtotal" was true only for VAT-inclusive THB).
  - menu: `parseMoneyInput(text, branch.currency)` instead of THB satang literals.
  - receipt: cash round pays the real bill total (100_000 ₫ was short).
- Error assertions compare `errorKey` (+ `params`), never sentences:
  `error.staff_meal_other_bill` + `params.table === "B1"` · `error.locked_out.*` +
  `params.count > 0` · `error.cannot_edit_own_account`.
- receipt: §3–4 assert kind/taxId **for the seeded currency** (VND → RECEIPT,
  `sellerTaxId` null); §12 now flips to the *other* currency (VND→THB) so both
  TAX_ABB and RECEIPT are issued every run.
- settings: old receipt keeps the footer it was issued with
  (`original.receiptFooter`, not `null` — the seed now sets a footer).
- dashboard: top-item lookup by the item's DB name via id, not `"Kra Pao"`.
- Trap: `loginStaff()`'s union has a variant without `params` — narrow with
  `"params" in result` or tsc fails (tsx alone won't catch it).

## Current dev state (important for the next session)

- DB (VND) has audit data: **A2 paid** → receipt `HQ-00000055`
  (`cmtwidq5g000blkv05y5g9bjy`, 303.912 ₫) · **A1 open** (placed order + cart water×2)
  · **counter queue 1 open** (`cmtwidq8f000flkv0xwza7nag`, placed krapao + cart tea).
  Receipt numbers start at 55 because smoke runs advance the real counter (pre-existing).
- A prod server may still be listening on :3002 — kill it first:
  `Get-NetTCPConnection -LocalPort 3002 | % { Stop-Process -Id $_.OwningProcess -Force }`
- Cookies: `npm run dev:staff-cookie 001 pos|kds|admin` · `npm run dev:session a1x7qk`
- Audit runner used (scratchpad, recreate if gone): loops `vi`/`en`, adds cookie
  `pos_locale=<locale>`, spawns `node scripts/audit-screens.mjs` with
  `AUDIT_COOKIES`/`AUDIT_PAGES` JSON (`{path, scrolls?, openDetails?, mustSee: []}`).
  Pages audited: customer `/t/a1x7qk` (+`/item/seed-item-krapao`, `/cart`, `/orders`,
  `scrolls:true`) · `/kds`, `/kds?station=seed-station-hot` · `/pos`,
  `/pos/table/seed-table-a1` (+`?view=bills` openDetails, `/bill`), `/pos/counter`,
  `/pos/counter/<id>` (+`?view=bills`), `/pos/receipt/<id>` · admin: dashboard, menu,
  item, category, modifiers (+group), receipts (+detail), audit-logs, staff (+detail),
  settings · `/pos/login`, `/kds/login`, `/admin/login`, `/` (`scrolls:true`, no cookies).
- Git Bash: `export MSYS_NO_PATHCONV=1`, and then pass Windows-style paths
  (`C:/Users/...`) to node — `/c/Users/...` is no longer converted.

## Next steps (Task 11, in order)

1. Close the POS audit false alarm (above) and re-run POS in both locales → expect 80/80.
2. **Step 3 print check:** open `/pos/receipt/<id>`, print to PDF; whole receipt
   renders (not one screen-height slice), no POS chrome, **no locale switcher**
   (`data-print-hide` on the switcher wrapper).
3. Optional: grep served HTML of each screen for Thai characters (`[ก-๙]`) — DB is
   Vietnamese now, UI is vi/en, so any hit is a missed string.
4. **Step 4 report:** `archive/report/2026-09-09-i18n-vnd.md` (built · traps · numbers ·
   not done). Traps worth recording: `.pos-skin` specificity → switcher wrapped in
   `hidden sm:block` div in POS/KDS/admin headers; audit check 5 (bar child escaping
   an `overflow-hidden` header/nav); admin bottom bar now `overflow-x-auto` +
   scroll-into-view (English "Settings" was clipped at 390px); dev:session double
   OPEN session; tax-ID rule per country (`error.tax_id_invalid.<CURRENCY>`);
   `intlLocale()` only for server-rendered dates with month names.
5. **Step 5 CLAUDE.md:** locale cookie `pos_locale` + "`lib/server/*` returns keys";
   tsc-enforced dictionary parity (`vi.ts` source of truth); branch VND /
   Asia/Ho_Chi_Minh / VAT 8% exclusive / SC 5%; Archivo `vietnamese` subset (Noto
   Sans Thai gone); audit in **both** locales + check 5; fix the stale "DB menu data is
   English" line (now Vietnamese); smoke tally 16 sets / 849; replace the
   "กำลังทำค้างอยู่" section.
6. **Step 6:** `npm run typecheck && npm run lint && npm run build` + all 16 smoke →
   commit "i18n + VND: screen audit in both locales, report, CLAUDE.md".
7. Finish the branch (superpowers:finishing-a-development-branch); mention deleting
   `wip/i18n-task4`.

## Not done / deliberately out of scope

- No new features; chapter 15 (reports/shift close) is next after this branch.
- Code comments stay Thai by decision; only user-facing strings are vi/en.
