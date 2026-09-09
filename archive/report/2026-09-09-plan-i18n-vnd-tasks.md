# vi/en Runtime Switcher + VND Currency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A staff member taps VI/EN on any of the four screens and every word of
chrome changes; the branch runs on VND with a Vietnamese menu; and no smoke test
ever again asserts on display text.

**Architecture:** The locale lives in a per-device cookie. Server components read
it with `cookies()`; a thin client provider carries the active dictionary to the 22
client components. `vi.ts` is the source of truth and `en.ts` is typed against it, so
a missing translation is a `tsc` error rather than a runtime surprise. The whole
business layer (`lib/server/*`) stays locale-free: it returns **message keys**, and
only the presentation layer turns a key into a sentence.

**Tech Stack:** Next.js 16.2 (App Router) · React 19.2 · Prisma 7 (`prisma-client`
generator + `@prisma/adapter-pg`) · PostgreSQL 17 in Docker · Tailwind CSS 4 ·
smoke tests as `tsx --conditions=react-server` scripts

**Spec:** `archive/report/2026-09-09-plan-i18n-vnd-design.md` — read both; this plan
argues from that spec.

## Progress (updated 2026-09-09)

| Task | Status |
|---|---|
| 1 — i18n core | ✅ done · `cbb8f29` |
| 2 — locale plumbing, switcher, fonts | ✅ done · `6143018` |
| 3 — actions return message keys | ✅ done · `82ffb67` |
| 4 — enum label modules | 🟡 **in progress** · `wip/i18n-task4` @ `e3134d1` — does not build, ~46 call sites left |
| 5–8 — screen text per route group | ⬜ not started |
| 9 — VND branch + Vietnamese menu | ⬜ not started |
| 10 — smoke suite back to zero | ⬜ not started |
| 11 — screen audit, report, CLAUDE.md | ⬜ not started |

**Where things stand:** `feat/i18n-vi-en-vnd` tip is green (tsc 0, eslint clean,
build passes). Smoke is 810 PASS / 11 FAIL — all 11 are assertions still comparing
display sentences, no behavioural regression; Task 10 owns them.

**Read `archive/report/2026-09-09-i18n-vnd-progress.md` before resuming.**

## Global Constraints

- Money is `Int` in the branch currency's minor unit. **VND has no minor unit** —
  `45000` means `45.000 ₫`. Never divide by 100 outside `lib/money.ts`. No floats.
- **Never write a currency symbol on screen.** Always `formatMoney(amount, currency)`
  with `currency` from `branch.currency`; client components receive it as a prop.
- Every query filters by `staff.branchId`.
- Files in `lib/server/` begin with `import "server-only"`.
- A `"use server"` file may export **only** async functions. No constants, no types.
- `publishRealtimeEvent()` is called **after** commit, never inside `$transaction`.
- Multi-table writes go in a single `$transaction`.
- Import Prisma from `@/lib/generated/prisma/client`, never `@prisma/client`.
- Running `prisma generate`/`migrate` while `npm run dev` is up **requires a dev
  server restart**; otherwise you get a `Jest worker` error that points nowhere.
- New pages in `(pos)`/`(admin)` must set `min-h-0` + `overflow-auto` themselves.
  Anything added to a `flex-none` zone steals space from the scrollable zone.
- Design-system classes are `.pos-skin .xxx` (specificity 0-2-0) and **beat**
  single-class Tailwind utilities (0-1-0). To hide something responsively, wrap it
  in a plain `<div>` and hide the wrapper.
- **On-screen text is Vietnamese and English only. Code comments stay Thai.**
- Every user-facing string goes in the dictionaries. No literal sentence in a `.tsx`.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `lib/i18n/locales.ts` | `Locale` union, `LOCALES`, `DEFAULT_LOCALE`, `isLocale()` |
| `lib/i18n/cookie.ts` | the cookie name and nothing else |
| `lib/i18n/vi.ts` | **source of truth** — every string; exports `MessageKey`, `Dictionary` |
| `lib/i18n/en.ts` | `Record<MessageKey, string>` — parity enforced by tsc |
| `lib/i18n/dictionaries.ts` | `DICTIONARIES: Record<Locale, Dictionary>` |
| `lib/i18n/translate.ts` | pure `translate()`, `tCount()`, `MessageParams`, `CountKey` |
| `lib/server/locale.ts` | `getLocale()`, `getT()` — server-only |
| `app/locale-actions.ts` | `"use server"` — `setLocale()` |
| `components/i18n-provider.tsx` | client provider + `useT()` |
| `components/locale-switcher.tsx` | the VI/EN toggle |
| `scripts/smoke-i18n.ts` | smoke set 16 |

**Modified**

| File | Change |
|---|---|
| `app/layout.tsx` | `<html lang>` dynamic · Archivo gains `vietnamese` · Noto Sans Thai removed · provider wraps children |
| `app/globals.css` | font stack drops `var(--font-noto-thai)` |
| `lib/form-state.ts` | `message: string` → `messageKey` + `params` |
| `lib/order-status.ts`, `lib/payment-method.ts`, `lib/sale-point.ts`, `lib/audit-log.ts`, `lib/money.ts` | label maps → key builders |
| all 6 `"use server"` action files | `error: string` → `errorKey: MessageKey` |
| ~30 screen files across 4 route groups | literals → `t()` |
| `prisma/seed.ts` | VND branch, Vietnamese menu, `Asia/Ho_Chi_Minh` |
| 15 existing smoke scripts | assert keys, not sentences |
| `package.json` | `smoke:i18n` script |

---

### Task 1: The i18n core

Pure data and pure functions. No React, no Next, no cookies — so the smoke script
can exercise all of it directly.

**Files:**
- Create: `lib/i18n/locales.ts`, `lib/i18n/cookie.ts`, `lib/i18n/translate.ts`,
  `lib/i18n/vi.ts`, `lib/i18n/en.ts`, `lib/i18n/dictionaries.ts`
- Create: `scripts/smoke-i18n.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `type Locale = "vi" | "en"` · `DEFAULT_LOCALE: Locale` ·
  `isLocale(v: unknown): v is Locale` · `LOCALE_COOKIE: string` ·
  `type MessageKey` · `type Dictionary = Record<MessageKey, string>` ·
  `type MessageParams = Record<string, string | number>` · `type CountKey` ·
  `translate(dict, key, params?): string` · `tCount(dict, base, n, params?): string` ·
  `DICTIONARIES: Record<Locale, Dictionary>`

- [ ] **Step 1: Write `lib/i18n/locales.ts`**

```ts
/**
 * สองภาษาเท่านั้น — เวียดนามเป็นค่าตั้งต้น (ร้านอยู่เวียดนาม)
 *
 * ไม่มีการเดาภาษาจาก Accept-Language และไม่มี region variant (vi-VN/en-US)
 * เพราะคนที่ยืนอยู่หน้าเครื่อง POS เป็นคนเลือกเอง ไม่ใช่เบราว์เซอร์
 */
export const LOCALES = ["vi", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "vi";

/** cookie ที่ผู้ใช้แก้เองได้ จึงต้องตรวจก่อนใช้เสมอ ห้าม cast */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
```

- [ ] **Step 2: Write `lib/i18n/cookie.ts`**

```ts
/**
 * ชื่อ cookie ของภาษา — อยู่ไฟล์เดียวโดด ๆ ด้วยเหตุผลเดียวกับ
 * lib/table-session-cookie.ts: ไฟล์ที่ห้าม import อะไรที่มี "server-only"
 * (เช่น proxy.ts) ต้องเรียกชื่อนี้ได้ และไฟล์ "use server" ก็ export
 * ค่าคงที่ออกมาไม่ได้ จึงเก็บไว้ที่นี่ที่เดียว
 */
export const LOCALE_COOKIE = "pos_locale";

/** หนึ่งปี — ภาษาของเครื่องไม่ควรหลุดกลับเป็นค่าตั้งต้นเพราะปิดเบราว์เซอร์ */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
```

- [ ] **Step 3: Write `lib/i18n/translate.ts`**

```ts
import type { Dictionary, MessageKey } from "./vi";

export type MessageParams = Record<string, string | number>;

/**
 * คีย์ที่มีรูปเอกพจน์/พหูพจน์ — ดึงจากคีย์ที่ลงท้ายด้วย ".one" อัตโนมัติ
 * เพิ่มคู่ `.one`/`.other` ใน vi.ts แล้วคีย์ฐานจะใช้กับ tCount() ได้ทันที
 */
export type CountKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? Base : never;
}[MessageKey];

/**
 * แทนที่ {token} ด้วยค่าใน params
 *
 * token ที่ไม่มีใน params จะถูกปล่อยไว้ตามเดิม **ไม่ throw** — ป้ายที่เขียนผิด
 * ต้องทำให้เห็นข้อความแปลก ๆ หนึ่งบรรทัด ไม่ใช่ทำให้ทั้งจอ 500
 */
export function translate(
  dict: Dictionary,
  key: MessageKey,
  params?: MessageParams,
): string {
  const template = dict[key];

  if (params === undefined) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/**
 * เลือกรูปตามจำนวน — เวียดนามใช้รูปเดียวทั้งคู่ อังกฤษต้องแยก
 *
 * มีไว้เพื่อเลิกเขียน "try again in 5 minute(s)" ซึ่งเป็นสิ่งที่โค้ดทำอยู่ตอนนี้
 * `count` ถูกใส่ให้ใน params เสมอ จึงเขียน "{count} bills" ได้โดยไม่ต้องส่งเอง
 */
export function tCount(
  dict: Dictionary,
  base: CountKey,
  n: number,
  params?: MessageParams,
): string {
  const key = (n === 1 ? `${base}.one` : `${base}.other`) as MessageKey;
  return translate(dict, key, { count: n, ...params });
}
```

- [ ] **Step 4: Write `lib/i18n/vi.ts` with the starter keys**

Only the keys Tasks 1–4 need. Tasks 5–8 each append their own section; the
sections below are the permanent shape, so keep the comment banners.

```ts
/**
 * ข้อความภาษาเวียดนาม — **ต้นฉบับของทั้งระบบ**
 *
 * ไฟล์นี้เป็นแหล่งความจริงเรื่องรายชื่อคีย์: `en.ts` ประกาศเป็น
 * `Record<MessageKey, string>` เพราะฉะนั้นคีย์ที่เพิ่มที่นี่แล้วลืมแปล
 * จะทำให้ tsc พัง ไม่ใช่หลุดไปโผล่บนจอเป็นคีย์ดิบ
 *
 * กติกาของคีย์: แบน ใช้จุดคั่น namespace — "pos.table.open"
 * คู่ `.one`/`.other` = คีย์ที่ใช้กับ tCount()
 */
export const vi = {
  // ── ทั่วไป ────────────────────────────────────────────────────────────
  "common.save": "Lưu",
  "common.cancel": "Hủy",
  "common.confirm": "Xác nhận",
  "common.back": "Quay lại",
  "common.close": "Đóng",
  "common.search": "Tìm kiếm",
  "common.language": "Ngôn ngữ",

  // ── สถานะบิล (lib/order-status.ts) ────────────────────────────────────
  "orderStatus.DRAFT": "Giỏ hàng",
  "orderStatus.PLACED": "Đã gửi bếp",
  "orderStatus.IN_PROGRESS": "Đang chế biến",
  "orderStatus.READY": "Sẵn sàng phục vụ",
  "orderStatus.SERVED": "Đã phục vụ",
  "orderStatus.PAID": "Đã thanh toán",
  "orderStatus.CANCELLED": "Đã hủy",

  // ── สถานะรายการ ───────────────────────────────────────────────────────
  "orderItemStatus.DRAFT": "Trong giỏ",
  "orderItemStatus.PLACED": "Chờ bếp",
  "orderItemStatus.IN_PROGRESS": "Đang chế biến",
  "orderItemStatus.READY": "Sẵn sàng phục vụ",
  "orderItemStatus.SERVED": "Đã phục vụ",
  "orderItemStatus.CANCELLED": "Đã hủy",

  // ── ปุ่มของจอครัว ─────────────────────────────────────────────────────
  "kitchenAction.PLACED": "Bắt đầu làm",
  "kitchenAction.IN_PROGRESS": "Xong món",

  // ── วิธีชำระเงิน ──────────────────────────────────────────────────────
  "paymentMethod.CASH": "Tiền mặt",
  "paymentMethod.QR": "QR",
  "paymentMethod.CARD": "Thẻ",

  // ── ช่องทางขาย (lib/sale-point.ts) ────────────────────────────────────
  "salePoint.DINE_IN": "Tại chỗ",
  "salePoint.COUNTER": "Mang đi",
  "salePoint.DELIVERY": "Giao hàng",
  "salePoint.tableNamed": "Bàn {name}",
  "salePoint.queued": "{channel} #{queue}",
  "salePoint.channelNamed": "{channel} · {name}",
  "salePoint.fieldTable": "Bàn",
  "salePoint.fieldChannel": "Kênh bán",

  // ── สกุลเงิน (lib/money.ts) ───────────────────────────────────────────
  "currency.THB": "Baht",
  "currency.LAK": "Kip",
  "currency.VND": "Đồng",

  // ── ข้อความผิดพลาดที่ action คืนออกมา ─────────────────────────────────
  "error.session_expired": "Phiên đã hết hạn — vui lòng nhập lại mã PIN",
  "error.not_allowed": "Bạn không có quyền thực hiện thao tác này",
  "error.bad_pin": "Sai mã nhân viên hoặc mã PIN",
  "error.locked_out.one": "Quá nhiều lần thử sai — thử lại sau {count} phút",
  "error.locked_out.other": "Quá nhiều lần thử sai — thử lại sau {count} phút",

  // ── ตัวสลับภาษา ───────────────────────────────────────────────────────
  "locale.vi": "Tiếng Việt",
  "locale.en": "English",
} as const;

export type MessageKey = keyof typeof vi;

export type Dictionary = Record<MessageKey, string>;
```

- [ ] **Step 5: Write `lib/i18n/en.ts`**

```ts
import type { Dictionary } from "./vi";

/**
 * ข้อความอังกฤษ
 *
 * ประกาศชนิดเป็น Dictionary ไม่ใช่ `as const` โดยตั้งใจ — ชนิดนี้บังคับให้มี
 * คีย์ครบเท่ากับ vi.ts เป๊ะ ๆ ขาดหนึ่งคีย์ tsc ฟ้อง เกินหนึ่งคีย์ก็ฟ้อง
 * (excess property check) เพราะฉะนั้น "แปลตกหล่น" กลายเป็น build error
 * ไม่ใช่บั๊กที่ไปโผล่บนจอลูกค้า
 */
export const en: Dictionary = {
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.back": "Back",
  "common.close": "Close",
  "common.search": "Search",
  "common.language": "Language",

  "orderStatus.DRAFT": "Cart",
  "orderStatus.PLACED": "Sent to kitchen",
  "orderStatus.IN_PROGRESS": "Preparing",
  "orderStatus.READY": "Ready to serve",
  "orderStatus.SERVED": "Served",
  "orderStatus.PAID": "Paid",
  "orderStatus.CANCELLED": "Cancelled",

  "orderItemStatus.DRAFT": "In cart",
  "orderItemStatus.PLACED": "Awaiting kitchen",
  "orderItemStatus.IN_PROGRESS": "Preparing",
  "orderItemStatus.READY": "Ready to serve",
  "orderItemStatus.SERVED": "Served",
  "orderItemStatus.CANCELLED": "Cancelled",

  "kitchenAction.PLACED": "Start cooking",
  "kitchenAction.IN_PROGRESS": "Mark ready",

  "paymentMethod.CASH": "Cash",
  "paymentMethod.QR": "QR",
  "paymentMethod.CARD": "Card",

  "salePoint.DINE_IN": "Dine-in",
  "salePoint.COUNTER": "Takeaway",
  "salePoint.DELIVERY": "Delivery",
  "salePoint.tableNamed": "Table {name}",
  "salePoint.queued": "{channel} #{queue}",
  "salePoint.channelNamed": "{channel} · {name}",
  "salePoint.fieldTable": "Table",
  "salePoint.fieldChannel": "Channel",

  "currency.THB": "Baht",
  "currency.LAK": "Kip",
  "currency.VND": "Dong",

  "error.session_expired": "Session expired — please enter your PIN again",
  "error.not_allowed": "You do not have permission to do that",
  "error.bad_pin": "Incorrect staff code or PIN",
  "error.locked_out.one": "Too many failed attempts — try again in {count} minute",
  "error.locked_out.other": "Too many failed attempts — try again in {count} minutes",

  "locale.vi": "Tiếng Việt",
  "locale.en": "English",
};
```

- [ ] **Step 6: Write `lib/i18n/dictionaries.ts`**

```ts
import type { Locale } from "./locales";
import type { Dictionary } from "./vi";
import { en } from "./en";
import { vi } from "./vi";

/**
 * ตารางภาษา → พจนานุกรม
 *
 * ทั้งสองภาษาถูก import ตรงนี้โดยตั้งใจ (ไม่ใช่ dynamic import) เพราะ
 * provider ฝั่ง client เลือกจากตารางนี้ ทำให้ข้อความทั้งสองภาษาอยู่ใน
 * chunk เดียวที่เบราว์เซอร์แคชครั้งเดียว — ถ้าส่งพจนานุกรมเป็น prop แทน
 * มันจะถูกส่งซ้ำใน RSC payload **ทุกครั้งที่เปลี่ยนหน้า** ซึ่งจอ POS ทำทั้งวัน
 */
export const DICTIONARIES: Record<Locale, Dictionary> = { vi, en };
```

- [ ] **Step 7: Write the failing smoke script `scripts/smoke-i18n.ts`**

```ts
/**
 * Smoke test ของชั้นภาษา (i18n)
 *
 * ไม่แตะ DB เลย — ทุกอย่างในชั้นนี้เป็นฟังก์ชันบริสุทธิ์โดยตั้งใจ เพื่อให้
 * ทดสอบได้โดยไม่ต้องมี request context (สคริปต์ smoke ไม่มี cookies())
 */
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/en";
import { DEFAULT_LOCALE, isLocale, LOCALES } from "@/lib/i18n/locales";
import { tCount, translate } from "@/lib/i18n/translate";
import { formatMoney } from "@/lib/money";
import { vi } from "@/lib/i18n/vi";

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log("\n── 1. พจนานุกรมครบคู่ ────────────────────────────────────────\n");

  const viKeys = Object.keys(vi).sort();
  const enKeys = Object.keys(en).sort();

  check("จำนวนคีย์เท่ากันทั้งสองภาษา", viKeys.length === enKeys.length,
    `vi ${viKeys.length} · en ${enKeys.length}`);
  check("รายชื่อคีย์ตรงกันเป๊ะ", viKeys.join("|") === enKeys.join("|"));
  check("ไม่มีข้อความว่าง", [...viKeys, ...enKeys].every((k) =>
    (vi as Record<string, string>)[k]?.trim() !== "" &&
    (en as Record<string, string>)[k]?.trim() !== ""));

  console.log("\n── 2. isLocale / ค่าตั้งต้น ──────────────────────────────────\n");

  check("ค่าตั้งต้นคือเวียดนาม", DEFAULT_LOCALE === "vi", DEFAULT_LOCALE);
  check("รู้จักสองภาษา", LOCALES.length === 2, LOCALES.join(","));
  check("isLocale ผ่านเฉพาะค่าที่รู้จัก", isLocale("vi") && isLocale("en"));
  check("cookie ที่ผู้ใช้แก้มั่ว ๆ ไม่ผ่าน",
    !isLocale("th") && !isLocale("") && !isLocale(undefined) && !isLocale("VI"));

  console.log("\n── 3. การแทนค่า {token} ──────────────────────────────────────\n");

  check("แทนค่า token ได้",
    translate(vi, "salePoint.tableNamed", { name: "A1" }) === "Bàn A1",
    translate(vi, "salePoint.tableNamed", { name: "A1" }));
  check("อังกฤษได้คำของตัวเอง",
    translate(en, "salePoint.tableNamed", { name: "A1" }) === "Table A1");
  check("token ที่ไม่มีใน params ถูกปล่อยไว้ ไม่ throw",
    translate(vi, "salePoint.tableNamed", {}) === "Bàn {name}");
  check("ไม่ส่ง params เลยก็ไม่พัง",
    translate(vi, "orderStatus.PAID") === "Đã thanh toán");
  check("แทนได้หลาย token",
    translate(en, "salePoint.queued", { channel: "Takeaway", queue: 12 }) === "Takeaway #12");

  console.log("\n── 4. เอกพจน์/พหูพจน์ ────────────────────────────────────────\n");

  check("อังกฤษ 1 = เอกพจน์",
    tCount(en, "error.locked_out", 1) === "Too many failed attempts — try again in 1 minute");
  check("อังกฤษ 5 = พหูพจน์",
    tCount(en, "error.locked_out", 5) === "Too many failed attempts — try again in 5 minutes");
  check("เวียดนามใช้รูปเดียวทั้งสองจำนวน",
    tCount(vi, "error.locked_out", 1) === tCount(vi, "error.locked_out", 1)
      && tCount(vi, "error.locked_out", 5).includes("5 phút"));

  console.log("\n── 5. ตารางภาษา + เงิน VND ───────────────────────────────────\n");

  check("DICTIONARIES ครบทุกภาษา",
    LOCALES.every((locale) => DICTIONARIES[locale] !== undefined));
  check("VND ไม่มีทศนิยม คั่นหลักพันด้วยจุด สัญลักษณ์อยู่ท้าย",
    formatMoney(45_000, "VND") === "45.000 ₫", formatMoney(45_000, "VND"));
  check("VND ต้องไม่ถูกฟอร์แมตแบบมีทศนิยม",
    !formatMoney(45_000, "VND").includes(","), formatMoney(45_000, "VND"));

  console.log("\nรวม — ดูบรรทัด FAIL ด้านบน (ถ้ามี)\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 8: Register the script**

In `package.json` `scripts`, next to the other smoke entries:

```json
"smoke:i18n": "tsx --conditions=react-server scripts/smoke-i18n.ts",
```

- [ ] **Step 9: Run it and watch it pass**

```bash
npm run smoke:i18n
npm run typecheck
```

Expected: every line `PASS`, `tsc` silent. If `tsc` reports a missing key in
`en.ts`, that is the parity guard working — add the translation.

- [ ] **Step 10: Prove the parity guard actually fails**

Temporarily delete one line from `en.ts` and run `npm run typecheck`. Expect an
error naming the missing property. Restore the line. **Do not skip this** — a
guard nobody has seen fail is a guard nobody knows is wired up.

- [ ] **Step 11: Commit**

```bash
git add lib/i18n scripts/smoke-i18n.ts package.json
git commit -m "i18n core: dictionaries, translate(), tCount(), parity via tsc"
```

---

### Task 2: Locale plumbing — cookie, provider, switcher, fonts

**Files:**
- Create: `lib/server/locale.ts`, `app/locale-actions.ts`,
  `components/i18n-provider.tsx`, `components/locale-switcher.tsx`
- Modify: `app/layout.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `getLocale(): Promise<Locale>` · `getT(): Promise<Translator>` where
  `type Translator = { locale: Locale; t: (key: MessageKey, params?: MessageParams) => string; tc: (base: CountKey, n: number, params?: MessageParams) => string }`
  · `useT(): Translator` · `<I18nProvider locale>` · `<LocaleSwitcher />` ·
  `setLocale(locale: string): Promise<void>`

- [ ] **Step 1: Write `lib/server/locale.ts`**

```ts
import "server-only";

import { cookies } from "next/headers";

import { LOCALE_COOKIE } from "@/lib/i18n/cookie";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/locales";
import {
  tCount,
  translate,
  type CountKey,
  type MessageParams,
} from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

export type Translator = {
  locale: Locale;
  t: (key: MessageKey, params?: MessageParams) => string;
  tc: (base: CountKey, n: number, params?: MessageParams) => string;
};

/**
 * ภาษาของเครื่องนี้ — cookie เป็นของ "เครื่อง" ไม่ใช่ของ "คน"
 *
 * แท็บเล็ตในครัวตั้งเวียดนาม โน้ตบุ๊กเจ้าของร้านตั้งอังกฤษ และมือถือลูกค้า
 * เลือกเองได้ โดยไม่มีใครไปทับของใคร · ค่าที่อ่านไม่ออกตกกลับเป็นค่าตั้งต้น
 * เสมอ ห้าม throw — ภาษาที่ผิดต้องไม่ทำให้เปิดหน้าไม่ได้
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;

  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** ตัวแปลสำหรับ server component — `const { t } = await getT()` */
export async function getT(): Promise<Translator> {
  const locale = await getLocale();
  const dict = DICTIONARIES[locale];

  return {
    locale,
    t: (key, params) => translate(dict, key, params),
    tc: (base, n, params) => tCount(dict, base, n, params),
  };
}
```

- [ ] **Step 2: Write `app/locale-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/lib/i18n/cookie";
import { isLocale } from "@/lib/i18n/locales";

/**
 * สลับภาษาของเครื่องนี้
 *
 * ⚠ ไฟล์ "use server" export ได้เฉพาะ async function — ชื่อ cookie จึงอยู่ที่
 * lib/i18n/cookie.ts ไม่ใช่ที่นี่ (กฎเดียวกับ lib/form-state.ts)
 *
 * ค่าที่ไม่รู้จักถูกเมินเงียบ ๆ ไม่ throw: ปุ่มสลับภาษาที่ทำให้ทั้งจอพังคือ
 * สิ่งที่แย่กว่าการกดแล้วไม่มีอะไรเกิดขึ้น
 *
 * revalidatePath("/", "layout") เพราะภาษาถูกอ่านที่ layout ราก — ล้างแค่หน้า
 * เดียวจะได้จอที่หัวเป็นภาษาใหม่แต่เนื้อยังเป็นภาษาเก่า
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) {
    return;
  }

  const store = await cookies();

  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    // ไม่มีใครฝั่ง browser ต้องอ่าน cookie นี้ — provider รับภาษามาทาง prop
    httpOnly: true,
  });

  revalidatePath("/", "layout");
}
```

- [ ] **Step 3: Write `components/i18n-provider.tsx`**

```tsx
"use client";

import { createContext, useContext, useMemo } from "react";

import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import {
  tCount,
  translate,
  type CountKey,
  type MessageParams,
} from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

type Translator = {
  locale: Locale;
  t: (key: MessageKey, params?: MessageParams) => string;
  tc: (base: CountKey, n: number, params?: MessageParams) => string;
};

const I18nContext = createContext<Translator | null>(null);

/**
 * ส่งมาแค่ "ภาษา" ไม่ใช่ทั้งพจนานุกรม
 *
 * ถ้ารับพจนานุกรมเป็น prop มันจะถูก serialize ลง RSC payload ใหม่ทุกครั้ง
 * ที่เปลี่ยนหน้า ส่วนวิธีนี้ทั้งสองภาษาอยู่ใน chunk เดียวที่แคชครั้งเดียวจบ
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo<Translator>(() => {
    const dict = DICTIONARIES[locale];

    return {
      locale,
      t: (key, params) => translate(dict, key, params),
      tc: (base, n, params) => tCount(dict, base, n, params),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * ตัวแปลสำหรับ client component
 *
 * throw เมื่อไม่มี provider โดยตั้งใจ — เป็นความผิดพลาดตอนประกอบหน้าจอ
 * ที่ต้องเจอทันทีตอน dev ไม่ใช่ปล่อยให้ตกลงไปเป็นคีย์ดิบบนจอลูกค้า
 */
export function useT(): Translator {
  const ctx = useContext(I18nContext);

  if (ctx === null) {
    throw new Error("useT() ถูกเรียกนอก <I18nProvider>");
  }

  return ctx;
}
```

- [ ] **Step 4: Write `components/locale-switcher.tsx`**

```tsx
"use client";

import { useTransition } from "react";

import { setLocale } from "@/app/locale-actions";
import { useT } from "@/components/i18n-provider";
import { LOCALES } from "@/lib/i18n/locales";

/**
 * ปุ่มสลับภาษา VI / EN
 *
 * ⚠ ห้ามใช้ utility เดี่ยว ๆ แบบ `lg:hidden` ซ่อนตัวเองในเชลล์ POS —
 * คลาสของ design system เขียนเป็น `.pos-skin .xxx` (0-2-0) ซึ่งชนะ utility
 * คลาสเดียว (0-1-0) ถ้าต้องซ่อนตามขนาดจอให้ครอบด้วย <div> แล้วซ่อนตัวครอบ
 *
 * ต้องอยู่บน "หน้าล็อกอินด้วย" ไม่ใช่แค่หลังบ้าน — คนที่อ่านหน้าล็อกอินไม่ออก
 * เข้าไปหาปุ่มที่อยู่หลังการล็อกอินไม่ได้
 */
export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const { locale, t } = useT();
  const [pending, startTransition] = useTransition();

  return (
    <div className={`flex items-center gap-1 ${className}`} aria-label={t("common.language")}>
      {LOCALES.map((value) => {
        const active = value === locale;

        return (
          <button
            key={value}
            type="button"
            lang={value}
            aria-pressed={active}
            disabled={pending || active}
            onClick={() => startTransition(() => setLocale(value))}
            className={
              active
                ? "px-2 py-1 text-xs font-bold uppercase bg-neutral-900 text-neutral-50"
                : "px-2 py-1 text-xs font-bold uppercase text-neutral-500 hover:text-neutral-900"
            }
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite the font and shell parts of `app/layout.tsx`**

Replace the two `next/font` calls and the `<html>` element. Keep every existing
comment about the `var(--font-archivo)` trap — it is still true and still
load-bearing; only the Thai half goes away.

```tsx
import { Archivo } from "next/font/google";

import { I18nProvider } from "@/components/i18n-provider";
import { getLocale } from "@/lib/server/locale";

/**
 * ⚠ subsets ต้องมี "vietnamese" — สระ/วรรณยุกต์เวียดนาม (ế ộ ữ ằ) อยู่ใน
 * subset นั้น ไม่ใช่ latin ถ้าไม่ขอมา ตัวอักษรพวกนี้จะตกไปใช้ฟอนต์ระบบ
 * กลางคำ แล้วคำเดียวกันจะมีสองฟอนต์ปนกัน
 *
 * ตระกูลเดียวกับกับดักฟอนต์ไทยเดิม: **ต้องเปิดดู @font-face ที่ emit ออกมาจริง**
 * ห้ามเชื่อ option (adjustFontFallback: false ที่ Turbopack ไม่ทำตามคือหลักฐาน)
 */
const archivo = Archivo({
  subsets: ["latin", "vietnamese"],
  variable: "--font-archivo",
  display: "swap",
  adjustFontFallback: false,
});

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    <html lang={locale} className={archivo.variable}>
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
```

Also delete the `Noto_Sans_Thai` import and its call, and rewrite the block
comment above the fonts to describe the Vietnamese subset requirement rather
than the Thai glyph fallback chain.

- [ ] **Step 6: Update the font stack in `app/globals.css`**

Lines 53–54 currently read:

```css
  --font-heading: "Archivo", var(--font-noto-thai), system-ui, sans-serif;
  --font-body: "Archivo", var(--font-noto-thai), system-ui, sans-serif;
```

Become:

```css
  /* "Archivo" เขียนตรง ๆ ไม่ใช่ var(--font-archivo) — var นั้นมี
     "Archivo Fallback" (= local(Arial)) ต่อท้าย ซึ่งจะกินกลีฟก่อนถึงตัวถัดไป
     ตอนนี้ Archivo ขอ subset "vietnamese" มาแล้ว จึงครอบตัวอักษรเวียดนาม
     ได้เองทั้งหมด ไม่ต้องมีฟอนต์คู่แบบที่เคยต้องมีสำหรับภาษาไทย */
  --font-heading: "Archivo", system-ui, sans-serif;
  --font-body: "Archivo", system-ui, sans-serif;
```

- [ ] **Step 7: Verify the emitted `@font-face` really carries Vietnamese**

```bash
npm run build
npm run start -- -p 3002 &
curl -s http://localhost:3002/pos/login | grep -o '/_next/static/css/[^"]*\.css' | head -1
# then fetch that stylesheet and look for the Vietnamese range
curl -s http://localhost:3002/_next/static/css/<file>.css | grep -o 'unicode-range:[^;]*' | sort -u
```

Expected: at least one `unicode-range` covering **U+1EA0–U+1EF9** (Vietnamese
precomposed vowels) and **U+0102-0103, U+0110-0111, U+01A0-01A1, U+01AF-01B0**.

If that range is absent, Archivo does not serve a Vietnamese subset in this
version — fall back to `Be_Vietnam_Pro` for `--font-body` and keep Archivo for
`--font-heading` only if Archivo covers headings' characters. **Do not proceed
to Task 3 with unverified fonts**; every screen in Tasks 5–8 depends on this.

- [ ] **Step 8: Verify the switcher round-trips against a real server**

```bash
curl -s -c /tmp/jar -b /tmp/jar http://localhost:3002/pos/login | grep -o 'lang="[a-z]*"'
# expect lang="vi"
```

Then set the cookie by hand and confirm the served HTML changes language:

```bash
curl -s -H 'Cookie: pos_locale=en' http://localhost:3002/pos/login | grep -o 'lang="[a-z]*"'
# expect lang="en"
curl -s -H 'Cookie: pos_locale=zz' http://localhost:3002/pos/login | grep -o 'lang="[a-z]*"'
# expect lang="vi"  (garbage falls back, never 500)
```

- [ ] **Step 9: Run the full check set**

```bash
npm run typecheck && npm run lint && npm run build && npm run smoke:i18n
```

- [ ] **Step 10: Commit**

```bash
git add lib/server/locale.ts app/locale-actions.ts components/i18n-provider.tsx \
        components/locale-switcher.tsx app/layout.tsx app/globals.css
git commit -m "i18n plumbing: cookie locale, provider, switcher, Vietnamese font subset"
```

---

### Task 3: Actions return message keys

The risky task, and it lands before the screens so the screens are written once
against the final shape.

**Files:**
- Modify: `lib/form-state.ts`
- Modify: all six `"use server"` files (find with the command in Step 1)
- Modify: every client component reading `state.message`

**Interfaces:**
- Consumes: `MessageKey`, `MessageParams` from Task 1; `useT` from Task 2.
- Produces: `FormState` carrying `messageKey`/`params`; every action result of
  the form `{ ok: false; errorKey: MessageKey; params?: MessageParams }`.

- [ ] **Step 1: Inventory what changes**

```bash
grep -rn '"use server"' app lib --include=*.ts --include=*.tsx -l
grep -rn 'error: "' app lib | wc -l
grep -rn 'state.message\|\.message}' app components | wc -l
```

Write the counts down; Step 7 checks that none are left.

- [ ] **Step 2: Rewrite `lib/form-state.ts`**

Keep the existing block comment about `"use server"` export rules — it is still
the reason this file is separate — and add the key rationale.

```ts
import type { MessageParams } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

/**
 * ⚠ เก็บ **คีย์** ไม่ใช่ประโยค
 *
 * ถ้า action คืนประโยคสำเร็จรูป ข้อความ error จะค้างอยู่ในภาษาที่เซิร์ฟเวอร์
 * เลือกตอนนั้น กดสลับภาษาแล้วไม่เปลี่ยนตาม — ปุ่มสลับภาษาจะโกหก
 *
 * ผลพลอยได้ที่สำคัญไม่แพ้กัน: สคริปต์ smoke ตรวจ "คีย์" ซึ่งไม่ขยับตอนแปล
 * ภาษา — เทสต์ 11 เคสที่พังตอนแปลเป็นอังกฤษพังเพราะมันตรวจประโยค
 */
export type FormState =
  | { status: "idle" }
  | { status: "error"; messageKey: MessageKey; params?: MessageParams }
  | { status: "success"; messageKey: MessageKey; params?: MessageParams };

export const IDLE_FORM_STATE: FormState = { status: "idle" };
```

- [ ] **Step 3: Convert each action file**

For every `return { ok: false, error: "<sentence>" }`:

1. add a key to `lib/i18n/vi.ts` under the `error.*` section, and its English
   twin in `en.ts` — reuse the sentence that is already there as the English text
2. change the return to `{ ok: false, errorKey: "error.<name>" }`
3. where the sentence interpolated a value, pass `params`

Concrete example — `app/(pos)/pos/actions.ts:482` today:

```ts
return { ok: false, error: "Session expired — please enter your PIN again" };
```

becomes:

```ts
return { ok: false, errorKey: "error.session_expired" };
```

And the throttle message, which is the one that currently ships `"minute(s)"`:

```ts
return { ok: false, errorKey: "error.locked_out", params: { count: minutes } };
```

Rendered later with `tc("error.locked_out", minutes)`, so English finally gets
`1 minute` / `5 minutes` and Vietnamese gets one form.

- [ ] **Step 4: Update every consumer**

Client components that render `state.message` become:

```tsx
const { t } = useT();
// …
{state.status === "error" && <p className="alert">{t(state.messageKey, state.params)}</p>}
```

- [ ] **Step 5: Let the compiler find the rest**

```bash
npm run typecheck
```

Every remaining `error: "…"` site is now a type error. Work the list to zero.
**Do not silence one with a cast** — a cast here is a string that never gets
translated.

- [ ] **Step 6: Run every smoke set**

```bash
for s in order pos kds bill payment menu receipt staff-meal takeaway \
         staff-session staff-admin settings dashboard table-move tables i18n; do
  echo "── $s"; npm run smoke:$s 2>&1 | tail -3
done
```

Assertions comparing sentences now fail. **Leave them failing** — Task 10 owns
them. Record the failure count so Task 10 can prove it reached zero.

- [ ] **Step 7: Confirm the inventory is clean**

```bash
grep -rn 'error: "' app lib | grep -v errorKey   # expect no output
grep -rn 'state\.message\b' app components        # expect no output
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Actions return message keys instead of sentences"
```

---

### Task 4: Enum label modules become key builders

**Files:**
- Modify: `lib/order-status.ts`, `lib/payment-method.ts`, `lib/sale-point.ts`,
  `lib/audit-log.ts`, `lib/money.ts`
- Modify: every call site (the compiler lists them)

**Interfaces:**
- Produces: `orderStatusKey(s): MessageKey` · `orderItemStatusKey(s): MessageKey` ·
  `kitchenActionKey(s): MessageKey` · `paymentMethodKey(m): MessageKey` ·
  `salePointKey(k): MessageKey` · `currencyKey(c): MessageKey` ·
  `auditActionKey(action: string): MessageKey | null` ·
  `salePointDisplayName(table, session, t): string` ·
  `salePointFieldLabel(kind, t): string`

- [ ] **Step 1: Convert `lib/order-status.ts`**

Delete `ORDER_STATUS_LABEL`, `ORDER_ITEM_STATUS_LABEL` and `KITCHEN_ACTION_LABEL`.
The transition tables, `KITCHEN_NEXT_STATUS`, `rollUpOrderStatus()` and the rest
are logic, not text — leave them untouched.

```ts
import type { MessageKey } from "@/lib/i18n/vi";

/**
 * คีย์ของป้ายสถานะ — ตัวข้อความอยู่ในพจนานุกรม ไม่ได้อยู่ที่นี่แล้ว
 *
 * ไฟล์นี้ยังเป็นเจ้าของกติกาว่า "สถานะไหนใช้ป้ายไหน" เหมือนเดิม
 * เปลี่ยนแค่ว่ามันคืน **คีย์** แทน **คำ**
 */
export function orderStatusKey(status: OrderStatus): MessageKey {
  return `orderStatus.${status}`;
}

export function orderItemStatusKey(status: OrderItemStatus): MessageKey {
  return `orderItemStatus.${status}`;
}

export function kitchenActionKey(status: KitchenActionableStatus): MessageKey {
  return `kitchenAction.${status}`;
}
```

The template-literal return type checks against `MessageKey` at compile time, so
adding an enum member without a dictionary entry is a `tsc` error.

- [ ] **Step 2: Convert `lib/payment-method.ts` and the currency label**

```ts
export function paymentMethodKey(method: PaymentMethod): MessageKey {
  return `paymentMethod.${method}`;
}
```

In `lib/money.ts`, drop `label` from `CurrencyConfig` and its three values, and add:

```ts
export function currencyKey(currency: Currency): MessageKey {
  return `currency.${currency}`;
}
```

`formatMoney()`, `formatAmount()`, `parseMoneyInput()` and the rest are pure
arithmetic and formatting — **do not touch them**.

- [ ] **Step 3: Convert `lib/sale-point.ts` — the delicate one**

`salePointDisplayName()` is, per CLAUDE.md, the single place that decides what a
bill is called on kitchen tickets, receipts and receipt search. It stays that
single place and gains a translator argument:

```ts
type Translate = (key: MessageKey, params?: MessageParams) => string;

export function salePointDisplayName(
  table: { name: string; kind: SalePointKind },
  session: { queueNumber?: number | null } | null | undefined,
  t: Translate,
): string {
  if (showsInTableMap(table.kind)) {
    return t("salePoint.tableNamed", { name: table.name });
  }

  const channel = t(`salePoint.${table.kind}`);
  const queueNumber = session?.queueNumber;

  return queueNumber
    ? t("salePoint.queued", { channel, queue: queueNumber })
    : t("salePoint.channelNamed", { channel, name: table.name });
}

export function salePointFieldLabel(kind: SalePointKind, t: Translate): string {
  return t(showsInTableMap(kind) ? "salePoint.fieldTable" : "salePoint.fieldChannel");
}
```

`salePointBasePath()` returns a URL, not text — **leave it exactly as is.**

- [ ] **Step 4: Convert `lib/audit-log.ts` — keep the unknown-row rule**

CLAUDE.md is explicit: a row whose action has no label must still appear, showing
the raw action name. A row that vanishes because the code does not recognise it is
worse than an ugly row, because an investigator concludes the event never happened.

So the builder returns `null` rather than a key, and callers fall back to raw text:

```ts
const AUDIT_ACTION_KEYS: Record<string, MessageKey> = {
  "payment.take": "audit.action.payment_take",
  // …one entry per known action
};

/**
 * คืน null เมื่อไม่รู้จัก action — **ห้ามซ่อนแถวเด็ดขาด**
 * ผู้เรียกต้องแสดงชื่อ action ดิบแทน (กฎจากบทที่ 13a)
 */
export function auditActionKey(action: string): MessageKey | null {
  return AUDIT_ACTION_KEYS[action] ?? null;
}
```

Same treatment for `METADATA_LABEL` via `auditFieldKey(key): MessageKey | null`.
`auditMetadataFields()` keeps handling null / array / string metadata without
throwing — that behaviour is pinned by tests and must not regress.

- [ ] **Step 5: Fix all call sites**

```bash
npm run typecheck
```

Server components get `t` from `await getT()`; client components from `useT()`.

⚠ `lib/server/receipt.ts` `listReceipts()` computes a display name per row. It is
in the business layer, so it must **not** translate. Return the pieces
(`tableName`, `kind`, `queueNumber`) and let the screen call
`salePointDisplayName(...)`. Receipt search still matches on the stored table name
and the digits pulled out of the query, so searching `12` or `số 12` keeps working
— the digit extraction is what makes the search survive a language change at all.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run build && npm run smoke:i18n
git add -A
git commit -m "Enum label modules return message keys, not text"
```

---

### Tasks 5–8: Screen text extraction, one route group per commit

Same mechanical procedure four times; each gets its own task so a reviewer can
reject one route group without rejecting the others.

| Task | Route group | Entry points |
|---|---|---|
| **5** | `app/(customer)/` | `/t/[tableCode]`, `/item/[itemId]`, `/cart`, `/orders` |
| **6** | `app/(kds)/` | `/kds/login`, `/kds`, ticket actions |
| **7** | `app/(pos)/` | login, table map, table screen, counter, bill, receipt |
| **8** | `app/(admin)/` | login, dashboard, menu, modifiers, receipts, staff, settings, audit logs |

**Procedure for each (repeat in full — do not read this from another task):**

- [ ] **Step 1: List the files holding user-facing text**

```bash
# Thai leftovers
grep -rlP '[\x{0E00}-\x{0E7F}]' "app/(GROUP)" | sort
# English sentences already on screen
grep -rn '>[A-Z][a-z]* [a-z]' "app/(GROUP)" --include=*.tsx | head -50
```

- [ ] **Step 2: Add that group's keys to `lib/i18n/vi.ts` under a banner comment**

```ts
  // ── จอลูกค้า (customer) ───────────────────────────────────────────────
  "customer.menu.title": "Thực đơn",
```

- [ ] **Step 3: Add the English twins to `lib/i18n/en.ts`**

`npm run typecheck` names every key you missed.

- [ ] **Step 4: Replace the literals**

Server component:

```tsx
import { getT } from "@/lib/server/locale";

export default async function Page() {
  const { t } = await getT();
  return <h1>{t("customer.menu.title")}</h1>;
}
```

Client component:

```tsx
"use client";
import { useT } from "@/components/i18n-provider";

export function Thing() {
  const { t } = useT();
  return <button>{t("common.save")}</button>;
}
```

- [ ] **Step 5: Put the switcher on this group's shell and its login screen**

`<LocaleSwitcher />` in the group layout, **and** on the login page — someone who
cannot read the login screen cannot reach a switcher that lives behind it.

⚠ Wrap it in a plain `<div>` if it must hide responsively (`.pos-skin` specificity).

- [ ] **Step 6: Confirm nothing is left**

```bash
grep -rlP '[\x{0E00}-\x{0E7F}]' "app/(GROUP)" --include=*.tsx
```

Only comments may match. Any JSX text node that matches is a miss.

- [ ] **Step 7: Read the served HTML in both languages**

```bash
npm run build && npm run start -- -p 3002 &
curl -s -H 'Cookie: pos_locale=vi' 'http://localhost:3002/<route>' | grep -o '<h1[^>]*>[^<]*'
curl -s -H 'Cookie: pos_locale=en' 'http://localhost:3002/<route>' | grep -o '<h1[^>]*>[^<]*'
```

⚠ On Git Bash set `MSYS_NO_PATHCONV=1` or a path argument like `/admin/menu` is
rewritten to `C:/Program Files/Git/admin/menu`.

CLAUDE.md records three separate occasions where tests were green while the screen
was wrong. Reading served HTML is the only step that catches those.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "i18n: extract <GROUP> screen text to dictionaries"
```

---

### Task 9: VND branch + Vietnamese menu

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Change the branch record**

```ts
      code: "HQ",
      name: "Nhà hàng Sen Vàng — Chi nhánh trung tâm",
      // 500 bp = phí phục vụ 5% — จำนวนเต็มเสมอ ห้าม float
      serviceChargeBp: 500,
      // VAT 8% — อัตราลดของเวียดนามที่ครอบอาหาร/เครื่องดื่ม (มาตรฐานคือ 10%)
      vatRateBp: 800,
      /**
       * เมนูเวียดนามแบบนั่งทานส่วนใหญ่เขียน "giá chưa bao gồm VAT và phí phục vụ"
       * = ราคายังไม่รวม VAT → calculateBill() เดินเส้นทาง "บวกเพิ่ม"
       * ซึ่งเป็นคนละสูตรกับเส้นทาง "ถอดออก" ที่สาขาไทยเดิมใช้
       */
      pricesIncludeVat: false,
      addressLine: "128 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh",
      phone: "028 3822 1234",
      receiptFooter: "Cảm ơn quý khách — hẹn gặp lại!",
      /**
       * ⚠ VND ไม่มีหน่วยย่อย — 45000 คือ 45.000 ₫ ไม่ใช่ 450 ₫
       * ราคาทุกตัวด้านล่างเป็นจำนวนเต็มดองล้วน ห้ามมีเศษสตางค์
       */
      currency: "VND",
      /**
       * ⚠ ตัวนี้ลืมง่ายที่สุดในไฟล์ — timezone เป็นตัวกำหนด branchDayKey()
       * ซึ่งใช้ทั้งกับเลขบิลรายวัน (orderNumber) และ unique key ของเลขคิว
       * [branchId, queueDay, queueNumber] ทิ้งไว้เป็นเวลาไทยแล้ววันจะตัดผิดชั่วโมง
       */
      timezone: "Asia/Ho_Chi_Minh",
```

- [ ] **Step 2: Rewrite `STATIONS`**

```ts
const STATIONS = [
  { id: "seed-station-hot", code: "HOT", name: "Bếp nóng", sortOrder: 1 },
  { id: "seed-station-bar", code: "BAR", name: "Quầy pha chế", sortOrder: 2 },
  { id: "seed-station-dessert", code: "DESSERT", name: "Bếp bánh", sortOrder: 3 },
];
```

⚠ Keep the ids. They are referenced by `MENU_ITEMS` and the seed upserts by id.
⚠ "No kitchen station" is **`stationId: null`**, never a `Station` row — making it
a real station would put bottled water on the kitchen display.

- [ ] **Step 3: Rewrite `CATEGORIES` and `MENU_ITEMS`**

Keep the existing ids, `sortOrder` scheme and `groupIds` wiring; replace name,
description and `basePrice`. Prices are whole đồng in the 25.000–120.000 range:

```ts
  {
    id: "seed-item-krapao",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Cơm tấm sườn nướng",
    description: "Sườn heo nướng than, ăn kèm cơm tấm, đồ chua và nước mắm pha.",
    basePrice: 65_000,
    sortOrder: 1,
    groupIds: ["seed-mg-spice", "seed-mg-size", "seed-mg-topping"],
  },
```

Suggested spread across the five categories: phở and bún dishes 55.000–75.000 ·
cơm dishes 55.000–85.000 · appetisers (gỏi cuốn, chả giò) 35.000–55.000 ·
drinks (cà phê sữa đá, trà đào, nước mía) 25.000–45.000 · desserts (chè, bánh
flan) 25.000–40.000.

⚠ `sortOrder` for modifiers comes from the **array index**, so inserting in the
middle renumbers everything after it. Append new options at the end.

- [ ] **Step 4: Rewrite `MODIFIER_GROUPS` and `STAFF` names**

Groups become Kích cỡ / Độ cay / Topping / Đá & Đường. `priceDelta` values are
whole đồng and may be negative. Staff names become Vietnamese; **PINs stay
unchanged** (001=1234, 002=2345, 003=3456, 004=4567) so every existing smoke
script and the dev cookie tooling keep working.

- [ ] **Step 5: Reset and re-seed**

⚠ Stop `npm run dev` first. Running `prisma generate`/`migrate` underneath a live
dev server produces a `Jest worker` error that points nowhere near the cause.

```bash
npm run db:reset
npx prisma migrate dev
npm run db:seed
```

- [ ] **Step 6: Verify the money end to end**

```bash
npm run smoke:bill && npm run smoke:payment
```

Then confirm by eye that a bill reads e.g. `65.000 ₫` and never `65,000.00` or
`₫65.000`, and that a dine-in bill exceeds an identical takeaway bill by exactly
the 5% service charge.

- [ ] **Step 7: Commit**

```bash
git add prisma/seed.ts
git commit -m "Seed: VND branch on Asia/Ho_Chi_Minh with a Vietnamese menu"
```

---

### Task 10: Bring all sixteen smoke sets back to zero failures

**Files:** the 15 existing `scripts/smoke-*.ts`

- [ ] **Step 1: Get the current failure list**

```bash
for s in order pos kds bill payment menu receipt staff-meal takeaway \
         staff-session staff-admin settings dashboard table-move tables i18n; do
  echo "── $s"; npm run smoke:$s 2>&1 | grep -c '^FAIL'
done
```

- [ ] **Step 2: Convert every display-string assertion to a key assertion**

The 8 failures in `smoke-takeaway.ts` are the template. Today:

```ts
check(
  "ชื่อบิลของโต๊ะนั่ง = โต๊ะ + ชื่อโต๊ะ",
  salePointDisplayName(dineTable, dineFirst) === `โต๊ะ ${dineTable.name}`,
);
```

Becomes — assert the *rule*, in both languages, never one hard-coded sentence:

```ts
const tvi = (k: MessageKey, p?: MessageParams) => translate(vi, k, p);
const ten = (k: MessageKey, p?: MessageParams) => translate(en, k, p);

check(
  "ชื่อบิลของโต๊ะนั่งใช้คีย์ tableNamed ทั้งสองภาษา",
  salePointDisplayName(dineTable, dineFirst, tvi) === `Bàn ${dineTable.name}` &&
    salePointDisplayName(dineTable, dineFirst, ten) === `Table ${dineTable.name}`,
);
```

For action results, assert `errorKey`, never the rendered sentence:

```ts
check("PIN ผิดได้ข้อความกลาง ๆ", result.errorKey === "error.bad_pin");
```

- [ ] **Step 3: Recompute every hard-coded total for VND**

`smoke-takeaway.ts` pins `฿120.00` takeaway vs `฿132.00` dine-in. Those numbers
are now wrong twice over — different currency **and** VAT moved from inclusive to
exclusive. Recompute from `calculateBill()` rather than transcribing what the
code happens to print, so the assertion still tests arithmetic and not itself.

- [ ] **Step 4: Run everything to zero**

```bash
for s in order pos kds bill payment menu receipt staff-meal takeaway \
         staff-session staff-admin settings dashboard table-move tables i18n; do
  npm run smoke:$s 2>&1 | grep '^FAIL'
done
# expect no output at all
```

- [ ] **Step 5: Commit**

```bash
git add scripts
git commit -m "Smoke tests assert message keys and VND totals"
```

---

### Task 11: Screen audit in both locales, then documentation

- [ ] **Step 1: Measure every screen in Vietnamese and in English**

```bash
npm run build
npm run start -- -p 3002 &
AUDIT_ORIGIN=http://localhost:3002 AUDIT_COOKIES='pos_locale=vi; …' npm run audit:screens
AUDIT_ORIGIN=http://localhost:3002 AUDIT_COOKIES='pos_locale=en; …' npm run audit:screens
```

⚠ Against `build` + `start`, **never** the dev server. Seed real data first or you
get failures that are not layout bugs.

Vietnamese labels run longer than English ("Đã gửi bếp" vs "Placed";
"Báo cáo / Đóng ca" vs "Reports / Shift close"). The admin bottom bar is already
down to ~55px per slot with six modules at 390px. **A layout that passes in
English and breaks in Vietnamese is the expected failure here** — anything in a
fixed-height bar needs `whitespace-nowrap`.

- [ ] **Step 2: Fix what it finds, re-measure both locales**

- [ ] **Step 3: Check printing still works**

Open a receipt, print to PDF, confirm the whole document renders (not one
screen-height slice) and no POS chrome — including the switcher — lands on paper.
The switcher needs `data-print-hide`.

- [ ] **Step 4: Write the report**

`archive/report/2026-09-09-i18n-vnd.md` — what was built, the traps hit, the
verified numbers, and what deliberately was not done.

- [ ] **Step 5: Update `CLAUDE.md`**

Add a section covering:
- the locale cookie and the rule that **`lib/server/*` returns keys, never sentences**
- dictionary parity enforced by `tsc`; `vi.ts` is the source of truth
- **the branch is VND on `Asia/Ho_Chi_Minh`, VAT 8%, service 5%, prices VAT-exclusive**
- Archivo now carries the `vietnamese` subset; Noto Sans Thai is gone
- `audit:screens` must run in **both** locales from now on
- correct the stale line claiming DB menu data is Thai — it is Vietnamese now
- update the smoke tally to sixteen sets

- [ ] **Step 6: Final verification, then commit**

```bash
npm run typecheck && npm run lint && npm run build
# all sixteen smoke sets, expect zero FAIL lines
```

```bash
git add -A
git commit -m "i18n + VND: screen audit in both locales, report, CLAUDE.md"
```

---

## Self-Review

**Spec coverage.** §4 core → Task 1. §4.4 both-dictionaries → Task 1 Step 6.
§5 keys-not-sentences → Tasks 3 and 4. §5.1 `FormState` → Task 3 Step 2.
§5.2 label modules → Task 4. §6 delivery + switcher placement → Task 2 and each
of Tasks 5–8 Step 5. §7 fonts → Task 2 Steps 5–7. §8 seed → Task 9.
§9.2 both-locale audit → Task 11 Step 1. §9.3 specificity → Task 2 Step 4 and
Tasks 5–8 Step 5. §10 testing → Tasks 1, 10, 11. **No gap found.**

**Type consistency.** `Translator` is defined once in Task 2 and mirrored in the
provider; `t`/`tc` keep those names everywhere. `MessageKey`/`Dictionary` come
from `vi.ts` in every task. `salePointDisplayName()` takes `(table, session, t)`
in Tasks 4 and 10 alike.

**Known deviation from spec.** Spec §8.1 as first drafted said VAT 10% and
`pricesIncludeVat: true`; it was corrected to 8% / `false` to match the Vietnam
case already in `scripts/smoke-bill.ts:215`. The spec now carries the corrected
values and this plan follows them.
