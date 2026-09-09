# Vietnamese/English runtime switcher + VND currency — design spec

> **Status:** agreed design, awaiting implementation plan
> **Written:** 2026-09-09
> **Language of this doc:** English (the codebase is moving off Thai; comments stay Thai per existing convention)

## 1. Goal

Two things, one chunk, because they share the same seed reset:

1. **A real runtime language switcher, vi ⇄ en**, covering all four screens
   (customer QR · POS · KDS · back office). Not a translation pass — a layer.
2. **The branch runs on VND**, with a Vietnamese menu priced in đồng.

Success is: a staff member taps VI/EN on any screen and every word of chrome
changes, prices read `45.000 ₫`, and no smoke test asserts on display text ever again.

## 2. Decisions locked with the user

| Question | Decision | Why |
|---|---|---|
| How vi + en coexist | **Runtime switcher** | Both languages live at once |
| Where the locale lives | **Cookie, per device** | Kitchen tablet in Vietnamese, owner's laptop in English, customer picks on their own phone. No migration. Matches how session/last-staff state is already stored. |
| Thai | **Dropped entirely** — two locales | Every string exists in exactly vi and en; a third locale is a permanent tax on every new string |
| Menu data | **Vietnamese dishes, VND prices** | Vietnamese capstone demo |
| Menu data language | **Single language in the DB** | Menu names are *data*, not chrome. Bills already snapshot `nameSnapshot`, so history is safe regardless. |
| Default locale | **vi** | Vietnamese restaurant POS |
| DB migration | **Full reset + re-seed** | The currency guard (can't switch currency once a branch has payments) is correct and stays. We work around it, not weaken it. |
| The 11 failing smoke assertions | **Folded into this work** | They assert display strings that are about to change again |

## 3. Non-goals (YAGNI)

- No locale in the URL. See §9.1 — it would invalidate every printed QR code.
- No translation of DB content (dish names, station names, category names,
  `receiptFooter`, staff names). Stored data is displayed as stored.
- No third locale, no locale negotiation from `Accept-Language`, no
  region variants (`vi-VN` / `en-US`). Two literal values.
- No translation of AuditLog *metadata values* — only the action labels and field names.
- Chapter 15 (shifts) stays untouched and comes after this.

## 4. Architecture — the i18n core

```
lib/i18n/
  locales.ts     Locale = "vi" | "en" · LOCALES · DEFAULT_LOCALE = "vi" · isLocale()
  cookie.ts      the cookie name, alone in its own file
  vi.ts          source of truth — every string, sectioned by screen
  en.ts          const en: Record<MessageKey, string>
  translate.ts   pure translate(dict, key, params) + tCount() + type MessageParams — no server-only
lib/server/locale.ts           getLocale() via cookies() — server-only
components/i18n-provider.tsx   "use client" — provider + useT()
components/locale-switcher.tsx "use client" — the VI/EN toggle
```

### 4.1 Parity is a compile error, not a test

`vi.ts` is the source of truth and exports `type MessageKey = keyof typeof vi`.
`en.ts` declares `const en: Record<MessageKey, string>`, so:

- a **missing** English translation is a `tsc` error
- a **stray** English key is an excess-property error

No runtime "missing key" fallback that silently goes stale, no lint rule to maintain.
This is the same trick `Record<StaffScreen, string>` already plays in
`lib/staff-session-cookie.ts`, which is what forced the admin cookie to be added
in chapter 13 — it works, so reuse it.

### 4.2 Keys

Flat and dotted: `"pos.table.open"`, `"orderStatus.PLACED"`, `"error.session_expired"`.
Flat keeps the parity type trivial; dots give greppable namespaces.

### 4.3 Interpolation and counts

`{name}` tokens filled from a params object; unknown tokens are left as-is rather
than throwing, because a malformed label must never take down a screen.

Counts use a `.one` / `.other` key pair plus `tCount(key, n)`. Vietnamese uses
one form for both; English needs two. This exists specifically so we stop
shipping `"try again in 5 minute(s)"`, which is what the code writes today.

### 4.4 Both dictionaries ship to the client

The provider imports both `vi` and `en` and selects on a `locale` prop, rather
than receiving a pre-resolved dictionary from the server.

Passing the dictionary as a prop would re-send it in the RSC payload on **every
navigation**. Importing both puts them in one JS chunk the browser caches once.
A POS navigates constantly, so the cached chunk wins, at the cost of shipping
~2× the text a single time.

## 5. The rule that keeps this from rotting

> **`lib/server/*` never translates. It returns keys. Only the presentation layer translates.**

The whole business layer stays locale-free:

- `getTableBill()`, `takePayment()`, `loginStaff()` and friends return
  `errorKey: MessageKey`, never a sentence.
- Screens call `t(errorKey, params)` at the point of render.

Three things fall out of this for free:

1. **Smoke tests assert keys.** They run under `tsx --conditions=react-server`
   with no request context, so they could never call `getLocale()` anyway.
   This is what permanently fixes the fragility that broke 11 tests this week.
2. **`cookies()` never gets called from the business layer**, so nothing in
   `lib/server/*` becomes request-bound and untestable.
3. An error raised in a transaction can't accidentally bake in the wrong language.

### 5.1 `FormState` and action return shapes

```ts
export type FormState =
  | { status: "idle" }
  | { status: "error";   messageKey: MessageKey; params?: MessageParams }
  | { status: "success"; messageKey: MessageKey; params?: MessageParams };
```

Action results move from `{ ok: false; error: string }` to
`{ ok: false; errorKey: MessageKey; params?: MessageParams }`.

`lib/form-state.ts` stays a separate file from any `"use server"` file — that
constraint is unchanged and still load-bearing (a `"use server"` file may export
only async functions).

### 5.2 Enum label modules

`order-status.ts`, `payment-method.ts`, `sale-point.ts`, `audit-log.ts` and the
currency `label` in `money.ts` currently export `Record<Enum, string>` maps of
finished text. They stop holding text and instead expose key builders:

```ts
export function orderStatusKey(status: OrderStatus): MessageKey {
  return `orderStatus.${status}`;
}
```

The text moves into the dictionaries. The modules keep owning *which* label
applies — that logic is untouched.

**`salePointDisplayName()` is the delicate one.** It returns the name a bill is
called by on kitchen tickets, receipts and the receipt search, and CLAUDE.md
names it the single place that decides that. It becomes locale-aware by taking
the translator, keeping it the single place. Consequence to accept deliberately:
a receipt reprinted while the screen is in English says `Table A1`, in Vietnamese
`Bàn A1`. That is correct — chrome is not part of the receipt snapshot. The
snapshotted seller identity and amounts still never move, and `receiptFooter`
is stored text that is displayed as stored, never translated.

## 6. Locale delivery per screen

- `app/layout.tsx` reads the locale, sets `<html lang={locale}>`, and wraps
  children in the provider. One place covers all four route groups.
- Server components: `const t = await getT()`.
- Client components: `const t = useT()`.
- The switcher writes the cookie in a server action and refreshes.

**Placement:** POS sidebar · KDS top bar · admin nav · customer menu header —
**and on all three login screens**, because someone who cannot read the login
screen cannot log in to reach a switcher that lives behind it.

## 7. Fonts

`app/layout.tsx` loads Archivo with `subsets: ["latin"]` and pairs it with
Noto Sans Thai. Vietnamese diacritics (ế, ộ, ữ, ằ) are in the **`vietnamese`**
subset, which is not currently requested.

- Archivo gains `subsets: ["latin", "vietnamese"]`
- Noto Sans Thai is removed
- `app/globals.css` writes `"Archivo"` directly (never `var(--font-archivo)`) —
  that stays, for the documented reason

**Verification is mandatory and not optional:** read the emitted `@font-face`
rules and confirm a `unicode-range` covering U+1EA0–U+1EF9 is actually present.
CLAUDE.md records an entire lost afternoon to trusting a font *option* over
emitted CSS (`adjustFontFallback: false`, which Turbopack ignores). Same rule here.

## 8. VND + Vietnamese seed

### 8.1 Branch

| Field | From | To | Note |
|---|---|---|---|
| `currency` | `THB` | `VND` | 0 decimals — `45000` means `45.000 ₫` |
| `timezone` | `Asia/Bangkok` | `Asia/Ho_Chi_Minh` | **drives `branchDayKey()`, order numbers and the `[branchId, queueDay, queueNumber]` uniqueness** — easy to miss |
| `vatRateBp` | `700` (Thailand 7%) | `1000` (Vietnam 10%) | |
| `serviceChargeBp` | `1000` | `500` | 5% is the common Vietnamese sit-down rate. **Deliberately not 0** — 0 would erase the dine-in vs takeaway difference that `chargesServiceCharge()` exists to express, and silently neuter the smoke case asserting dine-in costs more than takeaway for identical items. |
| `pricesIncludeVat` | `true` | `true` | unchanged; Vietnamese menus quote VAT-inclusive |
| `name` / `addressLine` / `phone` / `receiptFooter` | Thai | Vietnamese | |

### 8.2 Menu

5 categories, ~31 items, Vietnamese dishes, prices as whole đồng in the
25.000–120.000 range. Stations become Bếp nóng · Quầy pha chế · Bếp bánh.
Modifier groups become size / spice / topping / ice-sugar equivalents.

The 6→31 expansion done on 2026-08-26 is superseded here, but its structure
(upsert by stable id, `sortOrder` from array index, "No Kitchen Station" meaning
`stationId = null`) is kept exactly.

**Prices are whole đồng.** There is no minor unit, so nothing in the seed may
carry cents. `minorUnitsPerMajor(VND) === 1` already handles this in `lib/money.ts`.

## 9. Traps this design is deliberately routing around

### 9.1 Locale in the URL would break printed QR codes

`/t/<tableCode>` is encoded into QR codes already stuck to tables. A
`/[locale]/t/<tableCode>` restructure invalidates every one of them, and forces
a locale parameter through `salePointBasePath()` and every `redirect()` in the
app. The cookie approach touches neither routing nor QR codes.

### 9.2 Vietnamese text is longer than English in fixed-height bars

CLAUDE.md already records the admin bottom bar at ~55px per slot with six
modules at 390px, and a hint label that had to get `whitespace-nowrap`.
Vietnamese labels are frequently longer ("Đã gửi bếp" vs "Placed";
"Báo cáo / Đóng ca" vs "Reports / Shift close").

**`npm run audit:screens` must be run in both locales**, not once. A layout that
passes in English and breaks in Vietnamese is the expected failure mode here.

### 9.3 `.pos-skin` specificity beats Tailwind utilities

Design-system classes are `.pos-skin .xxx` (0-2-0) and beat single-class
utilities (0-1-0). The locale switcher must not rely on a bare `lg:hidden`-style
utility to hide itself — wrap it, or write it with utilities only. This has
already bitten the project once.

### 9.4 The currency guard stays

`/admin/settings` refuses a currency change once the branch has payments,
because stored integers are minor units of the old currency. That guard is
correct. We reset the dev DB rather than weaken it, and the smoke case pinning
that refusal stays green.

## 10. Testing

- **Dictionary parity:** `tsc` (§4.1). No test needed.
- **`smoke:i18n` (new):** `translate()` interpolation · `tCount()` singular/plural ·
  unknown/absent cookie falls back to `vi` · every enum key builder resolves in
  both dictionaries · a spot-check that VND formats as `45.000 ₫` and never `45,000.00`.
- **Existing 15 smoke sets:** assertions on display strings become assertions on
  keys. The 11 currently failing (takeaway 8 · staff-session 2 · staff-admin 1)
  are corrected by construction rather than patched.
- **`audit:screens` in both locales** (§9.2), against `npm run build` +
  `npm run start`, never the dev server.
- **Real HTML from a real server** for the switcher round-trip — CLAUDE.md
  records three separate occasions where tests stayed green while the screen
  was wrong, all caught only by reading served HTML.
- **Emitted `@font-face`** (§7).

## 11. Task sequence

Each task ends at a commit and something independently verifiable.

0. **Commit the three finished-but-uncommitted chunks first** (admin tables,
   expired-session fix, menu seed expansion) so the i18n diff is readable.
1. i18n core — dictionaries, `translate()`, provider, `getLocale()`, switcher,
   fonts, `<html lang>`. No screen text moved yet.
2. `FormState` + action return shapes → keys. Enum label modules → key builders.
3. Screen extraction, one route group per commit: customer → KDS → POS → admin.
4. VND + Vietnamese seed, DB reset, re-migrate, re-seed.
5. Smoke updates + new `smoke:i18n`.
6. `audit:screens` both locales · font verification · report · CLAUDE.md.

Task 3 is the bulk. Task 2 is the risky one — it touches every action and every
form — and is why it lands before the screens rather than alongside them.
