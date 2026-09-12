# รายงานยอดขายย้อนหลัง + ส่งออก CSV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้เจ้าของร้าน/ผู้จัดการเลือกช่วงวันแล้วเห็นยอดขาย · เมนูขายดี · ยอดต่อพนักงาน ·
ช่องทางจ่าย แล้วกดส่งออกเป็น CSV ได้

**Architecture:** อ่านจากตารางที่มีอยู่ทั้งหมด ไม่มี migration — ยอดเงินมาจาก `Payment`
ส่วนจำนวนชิ้นมาจาก `OrderItem` ของบิลที่ **จ่ายแล้วในช่วงนั้น** เพื่อให้ทุกส่วนของหน้า
บวกกลับได้ตรงกัน · การจัดกลุ่มตามวัน/ชั่วโมงทำฝั่ง JS ด้วย `Branch.timezone`
ไม่ใช่ `date_trunc` ของ Postgres (กันสองแหล่งความจริงเรื่องเขตเวลา)

**Tech Stack:** Next.js 16.2 App Router · Prisma 7 · TypeScript · Route Handler สำหรับ CSV

**Spec:** `archive/report/2026-09-12-plan-reports-design.md`

## Global Constraints

- เงินเป็น `Int` หน่วยย่อยของสกุลเงินสาขา · **ห้ามหาร 100 นอก `lib/money.ts`** · ห้าม float
- **ห้ามเขียน "฿" หรือ "₫" ลงหน้าจอ** ใช้ `formatMoney(amount, currency)` โดย
  `currency` มาจาก `branch.currency`
- **`lib/server/*` ห้ามแปลภาษา — คืน `errorKey` เท่านั้น** หน้าจอเป็นคนแปล
- **`lib/i18n/vi.ts` เป็นต้นฉบับของคีย์** · เพิ่มคีย์ต้องเพิ่ม `en.ts` ด้วยเสมอ
  ไม่งั้น **build พัง** (`Record<MessageKey, string>`)
- ทุก query กรอง `staff.branchId` เสมอ
- ไฟล์ใน `lib/server/` ขึ้นต้นด้วย `import "server-only"`
- ไฟล์ `"use server"` export ได้เฉพาะ async function
- import Prisma client จาก `@/lib/generated/prisma/client` ไม่ใช่ `@prisma/client`
- หน้าใหม่ใน `(admin)` ต้องใส่ `min-h-0` + `overflow-auto` เอง · ของที่เพิ่มในโซน
  `flex-none` จะไปกินพื้นที่โซนที่เลื่อนได้เสมอ
- **`audit:screens` ต้องรันสองภาษาเสมอ** (`pos_locale` ใน `AUDIT_COOKIES`)
- smoke คิดยอดที่คาดหวังจากราคาใน DB เสมอ **ห้ามเขียนตัวเลขไว้เอง**

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `lib/report-range.ts` | preset + ตรวจช่วง + จำกัด 92 วัน · เลขคณิตวันที่ล้วน ไม่แตะ DB | 1 |
| `lib/csv.ts` | `toCsv()` — escape + BOM ที่เดียวจบ | 1 |
| `lib/server/reports.ts` | `getSalesReport()` ตัวเดียวคืนทุกส่วน | 2-3 |
| `lib/rbac.ts` | `canViewReports` | 4 |
| `app/(admin)/admin/reports/page.tsx` | จอเดียวสี่ส่วน | 4 |
| `app/(admin)/admin/reports/_components/range-picker.tsx` | ฟอร์มเลือกช่วง (client) | 4 |
| `app/(admin)/admin/reports/export/route.ts` | Route Handler คืนไฟล์ CSV | 5 |
| `app/(admin)/admin/page.tsx` | ลิงก์เข้าหน้ารายงาน | 4 |
| `scripts/smoke-reports.ts` | smoke ชุดที่ 18 | 1-5 |

---

### Task 1: ช่วงเวลา + ตัวเขียน CSV (ฟังก์ชันล้วน ไม่แตะ DB)

**Files:**
- Create: `lib/report-range.ts` · `lib/csv.ts` · `scripts/smoke-reports.ts`
- Modify: `package.json` · `lib/i18n/vi.ts` · `lib/i18n/en.ts`

**Interfaces:**
- Produces:
  - `type ReportRange = { fromDay: string; toDay: string }`
  - `resolveReportRange(params: { preset?: string | null; from?: string | null; to?: string | null; todayYmd: string }): { ok: true; range: ReportRange } | { ok: false; errorKey: MessageKey }`
  - `REPORT_PRESETS: readonly ["today", "yesterday", "last7", "month"]`
  - `MAX_REPORT_DAYS = 92`
  - `toCsv(rows: (string | number | null)[][]): string`

- [ ] **Step 1: เพิ่มคีย์ข้อความสองภาษา**

ใน `lib/i18n/vi.ts` ต่อจากบรรทัด `"error.shift_already_open": ...`:

```ts
  "error.report_range_invalid": "Khoảng ngày không hợp lệ",
  "error.report_range_too_long": "Khoảng ngày tối đa là {days} ngày",
```

ใน `lib/i18n/en.ts` ต่อจากบรรทัดคีย์เดียวกัน:

```ts
  "error.report_range_invalid": "That date range isn't valid",
  "error.report_range_too_long": "The date range can be at most {days} days",
```

- [ ] **Step 2: เขียนเคสที่ยังไม่ผ่าน**

สร้าง `scripts/smoke-reports.ts`:

```ts
import "dotenv/config";

import { toCsv } from "@/lib/csv";
import { MAX_REPORT_DAYS, resolveReportRange } from "@/lib/report-range";
import { prisma } from "@/lib/server/db";

/**
 * Smoke test ของรายงานยอดขายย้อนหลัง + ส่งออก CSV
 *
 *     npm run smoke:reports
 *
 * ── สิ่งที่ชุดนี้ต้องพิสูจน์ ──────────────────────────────────────────────
 *   1. **ทุกส่วนของรายงานบวกกลับได้ตรงกัน** — แยกช่องทางจ่ายและแยกพนักงาน
 *      ต้องรวมได้เท่ายอดรวม ไม่งั้นทั้งหน้าเชื่อไม่ได้
 *   2. **ขอบช่วงถูกตามเวลาสาขา** ไม่ใช่ตาม UTC
 *   3. **CSV ที่ Excel เปิดแล้วอ่านภาษาเวียดนามออก** และ escape ถูก
 */

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
  }
}

async function main() {
  console.log("── ช่วงเวลา ────────────────────────────────────────────────────\n");

  const today = "2026-09-12";

  const preset = resolveReportRange({ preset: "last7", todayYmd: today });
  check(
    "preset 7 วันล่าสุดนับรวมวันนี้ (7 วัน ไม่ใช่ 8)",
    preset.ok && preset.range.fromDay === "2026-09-06" && preset.range.toDay === today,
    preset.ok ? `${preset.range.fromDay}..${preset.range.toDay}` : preset.errorKey,
  );

  const yesterday = resolveReportRange({ preset: "yesterday", todayYmd: today });
  check(
    "เมื่อวานเป็นวันเดียว ไม่ใช่ช่วงถึงวันนี้",
    yesterday.ok &&
      yesterday.range.fromDay === "2026-09-11" &&
      yesterday.range.toDay === "2026-09-11",
  );

  const month = resolveReportRange({ preset: "month", todayYmd: today });
  check(
    "เดือนนี้เริ่มวันที่ 1",
    month.ok && month.range.fromDay === "2026-09-01" && month.range.toDay === today,
  );

  const custom = resolveReportRange({ from: "2026-08-01", to: "2026-08-31", todayYmd: today });
  check("กรอกช่วงเองได้", custom.ok && custom.range.fromDay === "2026-08-01");

  const backwards = resolveReportRange({ from: "2026-08-31", to: "2026-08-01", todayYmd: today });
  check(
    "ช่วงที่กลับหัวกลับหาง = error ไม่ใช่สลับให้เงียบ ๆ",
    !backwards.ok && backwards.errorKey === "error.report_range_invalid",
  );

  const garbage = resolveReportRange({ from: "ไม่ใช่วันที่", to: today, todayYmd: today });
  check("รูปแบบวันที่ผิด = error", !garbage.ok);

  const tooLong = resolveReportRange({ from: "2026-01-01", to: "2026-12-31", todayYmd: today });
  check(
    "ช่วงเกิน 92 วัน = error ไม่ใช่ตัดเงียบ ๆ",
    !tooLong.ok && tooLong.errorKey === "error.report_range_too_long",
  );

  const exactLimit = resolveReportRange({ from: "2026-06-12", to: "2026-09-11", todayYmd: today });
  check(`ช่วง ${MAX_REPORT_DAYS} วันพอดียังผ่าน`, exactLimit.ok);

  const noParams = resolveReportRange({ todayYmd: today });
  check(
    "ไม่ระบุอะไรเลย = 7 วันล่าสุด (วันนี้อย่างเดียวมีหน้าสรุปวันนี้อยู่แล้ว)",
    noParams.ok && noParams.range.fromDay === "2026-09-06",
  );

  console.log("\n── CSV ─────────────────────────────────────────────────────────\n");

  const csv = toCsv([
    ["name", "qty", "amount"],
    ['Cơm "đặc biệt", loại lớn', 2, 84000],
    ["ไม่มีอะไรพิเศษ", 1, null],
  ]);

  check("ขึ้นต้นด้วย BOM (ไม่งั้น Excel อ่านภาษาเวียดนามเป็นขยะ)", csv.startsWith("﻿"));
  check(
    "ช่องที่มีคอมมาถูกครอบด้วยเครื่องหมายคำพูด",
    csv.includes('"Cơm ""đặc biệt"", loại lớn"'),
    csv.split("\r\n")[1],
  );
  check("เครื่องหมายคำพูดถูกหนีเป็นสองตัว", csv.includes('""đặc biệt""'));
  check("ขึ้นบรรทัดใหม่ด้วย CRLF ตามมาตรฐาน CSV", csv.includes("\r\n"));
  check("ตัวเลขไม่ถูกครอบด้วยเครื่องหมายคำพูด", csv.includes(",2,84000"));
  check("ค่า null เป็นช่องว่าง ไม่ใช่คำว่า null", csv.trimEnd().endsWith(",1,"));

  console.log(`\nรวม ${passed + failed} เคส — PASS ${passed} · FAIL ${failed}`);
}

main()
  .catch((error) => {
    console.error(error);
    failed += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
```

เพิ่มใน `package.json` ต่อจากบรรทัด `"smoke:shift"`:

```json
    "smoke:reports": "tsx --conditions=react-server scripts/smoke-reports.ts",
```

- [ ] **Step 3: รันให้เห็นว่าพัง**

Run: `npm run smoke:reports`
Expected: FAIL — `Cannot find module '@/lib/csv'`

- [ ] **Step 4: เขียน `lib/csv.ts`**

```ts
import type { Currency } from "@/lib/generated/prisma/enums";

/**
 * ประกอบ CSV ที่ Excel เปิดแล้วไม่เพี้ยน (spec §19)
 *
 * ── ทำไมต้องมี BOM ──────────────────────────────────────────────────────
 * Excel เดา encoding ของไฟล์ .csv จาก codepage ของเครื่อง ไม่ใช่ UTF-8 —
 * ชื่อเมนูภาษาเวียดนามจะกลายเป็นอักษรขยะทันทีถ้าไม่มี BOM นำหน้า
 * (ผู้ใช้จะสรุปว่า "ระบบพัง" ไม่ใช่ "Excel เดาผิด")
 *
 * ── ทำไม CRLF ───────────────────────────────────────────────────────────
 * RFC 4180 กำหนดไว้ และ Excel รุ่นเก่าบน Windows อ่าน LF เดี่ยวเป็นบรรทัดเดียวยาว ๆ
 */
const BOM = "﻿";

function escapeCell(value: string | number | null): string {
  if (value === null) {
    return "";
  }

  if (typeof value === "number") {
    return String(value);
  }

  // ครอบด้วยเครื่องหมายคำพูดเมื่อมีตัวที่ทำให้ผู้อ่านแยกช่องผิด และหนี " เป็น ""
  return /[",\r\n]/.test(value) ? `"${value.split('"').join('""')}"` : value;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return BOM + rows.map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * ชื่อไฟล์ที่บอกได้ว่าเป็นรายงานอะไรของช่วงไหน โดยไม่ต้องเปิดดู
 *
 * ปลอดภัยกับ header `Content-Disposition` เพราะเหลือแต่ `a-z0-9-_.` เท่านั้น
 */
export function csvFileName(type: string, range: { fromDay: string; toDay: string }): string {
  const safe = `report-${type}-${range.fromDay}-${range.toDay}.csv`;
  return safe.replace(/[^A-Za-z0-9._-]/g, "-");
}

/**
 * หัวคอลัมน์ของยอดเงิน — บอกสกุลไว้ในชื่อคอลัมน์ เพราะตัวเลขในไฟล์เป็น
 * **จำนวนเต็มหน่วยย่อยดิบ** ไม่ได้จัดรูป (สเปรดชีตต้องบวกคอลัมน์นี้ได้)
 */
export function amountHeader(label: string, currency: Currency): string {
  return `${label} (${currency})`;
}
```

- [ ] **Step 5: เขียน `lib/report-range.ts`**

```ts
import type { MessageKey } from "@/lib/i18n/vi";

/**
 * ช่วงวันของรายงาน (spec §5)
 *
 * ── ทำไมเป็นสตริง ไม่ใช่ Date ────────────────────────────────────────────
 * การแปลง "วันของสาขา" เป็น UTC อยู่ที่ `lib/server/branch-time.ts` ซึ่งมี
 * `import "server-only"` — ถ้าไฟล์นี้คืน Date มันจะต้อง import ตัวนั้นแล้ว
 * หน้าจอกับ route handler จะ import ไฟล์นี้ร่วมกันไม่ได้อีก
 *
 * ไฟล์นี้จึงเป็น **เลขคณิตวันที่ล้วน** ส่วนการแปลงเป็นช่วง UTC เกิดฝั่ง server
 * ด้วย `branchDayRangeUtc(range.fromDay, range.toDay, branch.timezone)`
 */
export type ReportRange = { fromDay: string; toDay: string };

export const REPORT_PRESETS = ["today", "yesterday", "last7", "month"] as const;

export type ReportPreset = (typeof REPORT_PRESETS)[number];

/**
 * เพดานความกว้างของช่วง
 *
 * รายงานดึงแถว `Payment` ทั้งช่วงมาจัดกลุ่มในหน่วยความจำ (ดูเหตุผลใน spec §4.3)
 * 92 วัน ≈ หนึ่งไตรมาส ซึ่งครอบการใช้งานจริงของร้านเดียว — กว้างกว่านี้ต้อง
 * ย้ายการจัดกลุ่มไปทำใน SQL ก่อน **ห้ามแค่เพิ่มตัวเลขนี้เฉย ๆ**
 */
export const MAX_REPORT_DAYS = 92;

const DAY_MS = 24 * 60 * 60 * 1000;

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** บวกวันแบบปฏิทิน โดยคิดที่ UTC เพื่อไม่ให้เขตเวลาของเครื่องมายุ่ง */
function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(fromDay: string, toDay: string): number {
  return (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS + 1;
}

function isPreset(value: unknown): value is ReportPreset {
  return typeof value === "string" && (REPORT_PRESETS as readonly string[]).includes(value);
}

function fromPreset(preset: ReportPreset, todayYmd: string): ReportRange {
  switch (preset) {
    case "today":
      return { fromDay: todayYmd, toDay: todayYmd };
    case "yesterday": {
      const day = addDays(todayYmd, -1);
      return { fromDay: day, toDay: day };
    }
    case "last7":
      // นับรวมวันนี้ → ถอยหลัง 6 วัน ไม่ใช่ 7 (ไม่งั้นได้ 8 วัน)
      return { fromDay: addDays(todayYmd, -6), toDay: todayYmd };
    case "month":
      return { fromDay: `${todayYmd.slice(0, 7)}-01`, toDay: todayYmd };
  }
}

/**
 * แปลง query string เป็นช่วงที่ใช้ได้จริง
 *
 * `preset` ชนะ `from`/`to` เมื่อส่งมาทั้งคู่ — ปุ่ม preset บนหน้าจอเขียน URL ใหม่
 * ทั้งชุดอยู่แล้ว การมีทั้งสองอย่างจึงแปลว่าผู้ใช้เพิ่งกดปุ่ม
 *
 * **ค่าที่อ่านไม่ออกต้องเป็น error ที่บอกได้ ไม่ใช่ตกกลับเงียบ ๆ** — ต่างจาก
 * cookie ภาษาที่ตกกลับได้ เพราะตรงนี้ผู้ใช้ตั้งใจถามถึงช่วงหนึ่ง การเงียบ ๆ
 * ตอบอีกช่วงแล้วเขาอ่านเป็นตัวเลขของช่วงที่ขอคือความเสียหายจริง
 */
export function resolveReportRange(params: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  todayYmd: string;
}): { ok: true; range: ReportRange } | { ok: false; errorKey: MessageKey } {
  if (isPreset(params.preset)) {
    return { ok: true, range: fromPreset(params.preset, params.todayYmd) };
  }

  if (!params.from && !params.to) {
    return { ok: true, range: fromPreset("last7", params.todayYmd) };
  }

  const fromDay = params.from ?? "";
  const toDay = params.to ?? "";

  if (!isYmd(fromDay) || !isYmd(toDay)) {
    return { ok: false, errorKey: "error.report_range_invalid" };
  }

  if (fromDay > toDay) {
    return { ok: false, errorKey: "error.report_range_invalid" };
  }

  if (daysBetween(fromDay, toDay) > MAX_REPORT_DAYS) {
    return { ok: false, errorKey: "error.report_range_too_long" };
  }

  return { ok: true, range: { fromDay, toDay } };
}
```

- [ ] **Step 6: รันเทสต์ให้ผ่าน**

Run: `npm run smoke:reports`
Expected: PASS ทุกเคส · FAIL 0

Run: `npm run typecheck && npm run lint`
Expected: ไม่มี output

- [ ] **Step 7: Commit**

```bash
git add lib/csv.ts lib/report-range.ts scripts/smoke-reports.ts package.json lib/i18n
git commit -m "Report date ranges and a CSV writer that Excel reads correctly"
```

---

### Task 2: `getSalesReport()` — ยอดขาย · ช่องทางจ่าย · พนักงาน

**Files:**
- Create: `lib/server/reports.ts`
- Modify: `scripts/smoke-reports.ts`

**Interfaces:**
- Consumes: `ReportRange` จาก Task 1 · `branchDayRangeUtc()` จาก `lib/server/branch-time.ts`
- Produces: `getSalesReport(branchId: string, range: ReportRange, timezone: string): Promise<SalesReport>`
  โดย `SalesReport` มี `revenue · billCount · averageBill · itemsSold · byDay · byHour · byMethod · byStaff · byItem`

- [ ] **Step 1: เขียนเคสที่ยังไม่ผ่าน**

ต่อใน `scripts/smoke-reports.ts` — เพิ่ม import:

```ts
import { getSessionBill } from "@/lib/server/billing";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { takePayment } from "@/lib/server/payment";
import { openTableByStaff } from "@/lib/server/pos";
import { getSalesReport } from "@/lib/server/reports";
import type { CurrentStaff } from "@/lib/server/staff-session";
```

แล้วเพิ่มตัวช่วยที่หัวไฟล์ (ก่อน `async function main`):

```ts
const TABLE_NAME = "RP-T1";
const KRAPAO = "seed-item-krapao";
const KRAPAO_OPTIONS = ["seed-mod-spice-mild", "seed-mod-size-regular"];

async function loadStaff(id: string): Promise<CurrentStaff> {
  return prisma.staff.findUniqueOrThrow({ where: { id }, include: { branch: true } });
}

/**
 * ล้างของที่ชุดนี้สร้าง — ลำดับถูกบังคับด้วย FK แบบ Restrict ทั้งสาย:
 * ออร์เดอร์ → ใบเสร็จ → การรับเงิน → รอบโต๊ะ → โต๊ะ
 */
async function cleanup(branchId: string) {
  const tables = await prisma.restaurantTable.findMany({
    where: { branchId, name: TABLE_NAME },
    select: { id: true },
  });
  const tableIds = tables.map((table) => table.id);

  if (tableIds.length === 0) {
    return;
  }

  const sessions = await prisma.tableSession.findMany({
    where: { tableId: { in: tableIds } },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);

  await prisma.orderItemModifier.deleteMany({
    where: { orderItem: { order: { tableId: { in: tableIds } } } },
  });
  await prisma.orderItem.deleteMany({ where: { order: { tableId: { in: tableIds } } } });
  await prisma.order.deleteMany({ where: { tableId: { in: tableIds } } });
  await prisma.receipt.deleteMany({ where: { payment: { tableSessionId: { in: sessionIds } } } });
  await prisma.payment.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: sessionIds } } });
  await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.restaurantTable.deleteMany({ where: { id: { in: tableIds } } });
}

/** ขายหนึ่งบิลแล้วคืนยอดที่จ่ายจริง — `paidAt` ถูกเลื่อนได้เพื่อทดสอบขอบช่วง */
async function sellOneBill(
  staff: CurrentStaff,
  tableId: string,
  method: "CASH" | "QR",
  quantity: number,
  paidAt?: Date,
) {
  const opened = await openTableByStaff(staff, tableId, 2);

  if (!opened.ok) {
    throw new Error(`เปิดโต๊ะไม่สำเร็จ: ${opened.errorKey}`);
  }

  const session = await prisma.tableSession.findFirstOrThrow({
    where: { tableId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  await addToCart({
    tableSessionId: session.id,
    branchId: staff.branchId,
    tableId,
    timezone: staff.branch.timezone,
    menuItemId: KRAPAO,
    quantity,
    modifierIds: KRAPAO_OPTIONS,
    note: null,
  });
  await placeOrder(session.id, { placedByStaffId: staff.id });

  const bill = await getSessionBill(staff.branchId, session.id);
  const total = bill!.bill.grandTotal;

  const paid = await takePayment(staff, tableId, {
    method,
    receivedAmount: method === "CASH" ? total : null,
    expectedTotal: total,
    sessionId: session.id,
  });

  if (!paid.ok) {
    throw new Error(`รับเงินไม่สำเร็จ: ${paid.errorKey}`);
  }

  if (paidAt) {
    // เลื่อนเวลาเพื่อทดสอบขอบช่วง — ทำได้เฉพาะในเทสต์ ไม่มีเส้นทางนี้ในแอป
    await prisma.payment.update({ where: { id: paid.paymentId }, data: { paidAt } });
  }

  return { paymentId: paid.paymentId, total };
}
```

แล้วต่อใน `main()` หลังส่วน CSV:

```ts
  console.log("\n── ยอดขายในช่วง ────────────────────────────────────────────────\n");

  const cashier = await loadStaff("seed-staff-cashier");
  const owner = await loadStaff("seed-staff-owner");
  const branchId = cashier.branchId;
  const timezone = cashier.branch.timezone;

  await cleanup(branchId);

  const table = await prisma.restaurantTable.create({
    data: {
      branchId,
      name: TABLE_NAME,
      tableCode: `rp-t1-${Date.now()}`,
      seats: 4,
      kind: "DINE_IN",
      sortOrder: 920,
    },
  });

  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const range = { fromDay: todayYmd, toDay: todayYmd };

  const beforeReport = await getSalesReport(branchId, range, timezone);

  const a = await sellOneBill(cashier, table.id, "CASH", 2);
  const b = await sellOneBill(cashier, table.id, "QR", 1);
  const c = await sellOneBill(owner, table.id, "CASH", 3);

  const sold = a.total + b.total + c.total;
  const report = await getSalesReport(branchId, range, timezone);

  check(
    "รายได้เพิ่มขึ้นเท่ายอดบิลที่เพิ่งขาย",
    report.revenue === beforeReport.revenue + sold,
    `${report.revenue} vs ${beforeReport.revenue + sold}`,
  );
  check("จำนวนบิลเพิ่มขึ้นสามใบ", report.billCount === beforeReport.billCount + 3);
  check(
    "บิลเฉลี่ยเป็นจำนวนเต็มและหารลง",
    Number.isInteger(report.averageBill) &&
      report.averageBill === Math.floor(report.revenue / report.billCount),
    `${report.averageBill}`,
  );
  check(
    "แยกช่องทางจ่ายบวกกลับได้เท่ายอดรวม",
    report.byMethod.reduce((sum, row) => sum + row.total, 0) === report.revenue,
  );
  check(
    "มีบรรทัดของทุกช่องทางแม้ยอดเป็นศูนย์ (คนอ่านต้องเห็นว่าไม่มี ไม่ใช่หาไม่เจอ)",
    report.byMethod.length === 3 && report.byMethod.some((row) => row.method === "CARD"),
  );
  check(
    "แยกพนักงานบวกกลับได้เท่ายอดรวม",
    report.byStaff.reduce((sum, row) => sum + row.total, 0) === report.revenue,
  );
  check(
    "แยกพนักงานนับคนรับเงิน ไม่ใช่คนกดสั่ง",
    report.byStaff.find((row) => row.staffId === owner.id)?.total === c.total,
  );

  console.log("\n── ขอบช่วงตามเวลาสาขา ──────────────────────────────────────────\n");

  const lastMinute = await sellOneBill(cashier, table.id, "CASH", 1, endOfBranchDay(todayYmd, timezone));
  const nextMidnight = await sellOneBill(cashier, table.id, "CASH", 1, startOfNextBranchDay(todayYmd, timezone));

  const edged = await getSalesReport(branchId, range, timezone);

  check(
    "บิลตอน 23:59 ของวันสุดท้ายถูกนับ",
    edged.revenue === report.revenue + lastMinute.total,
    `${edged.revenue - report.revenue} vs ${lastMinute.total}`,
  );
  check(
    "บิลตอนเที่ยงคืนของวันถัดไปไม่ถูกนับ",
    edged.revenue !== report.revenue + lastMinute.total + nextMidnight.total,
  );

  check(
    "ไม่ข้ามสาขา",
    (await prisma.branch.count({ where: { id: { not: branchId } } })) === 0 ||
      (await getSalesReport(
        (await prisma.branch.findFirstOrThrow({ where: { id: { not: branchId } } })).id,
        range,
        timezone,
      )).revenue === 0,
  );
```

และเพิ่มสองตัวช่วยเรื่องเวลาที่หัวไฟล์:

```ts
/** 23:59:30 ของวันนั้นตามเวลาสาขา คืนเป็น UTC */
function endOfBranchDay(ymd: string, timezone: string): Date {
  return new Date(branchMidnightUtc(ymd, timezone).getTime() + 24 * 60 * 60 * 1000 - 30_000);
}

/** เที่ยงคืนตรงของวันถัดไปตามเวลาสาขา */
function startOfNextBranchDay(ymd: string, timezone: string): Date {
  return new Date(branchMidnightUtc(ymd, timezone).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * เที่ยงคืนของวันนั้นตามเวลาสาขา เป็น UTC
 *
 * เขียนซ้ำในเทสต์แทนที่จะ import `startOfBranchDayUtc()` โดยตั้งใจ —
 * ถ้าใช้ฟังก์ชันเดียวกับที่โค้ดจริงใช้ เทสต์ขอบช่วงจะผ่านเสมอแม้ฟังก์ชันนั้นผิด
 */
function branchMidnightUtc(ymd: string, timezone: string): Date {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const shown = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(guess);
  const drift = Date.parse(`${shown}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`);
  return new Date(guess.getTime() - drift);
}
```

- [ ] **Step 2: รันให้เห็นว่าพัง**

Run: `npm run smoke:reports`
Expected: FAIL — `Cannot find module '@/lib/server/reports'`

- [ ] **Step 3: เขียน `lib/server/reports.ts`**

```ts
import "server-only";

import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import type { ReportRange } from "@/lib/report-range";
import { branchDayRangeUtc } from "@/lib/server/branch-time";
import { prisma } from "@/lib/server/db";

/**
 * รายงานยอดขายย้อนหลัง (spec §18)
 *
 * ── ยอดเงินมาจาก `Payment` เท่านั้น ──────────────────────────────────────
 * กฎตั้งแต่บทที่ 11: ยอดในคอลัมน์ของ `Order` เป็น **ส่วนแบ่ง** ที่กระจายไว้
 * ทำรายงานแยกช่องทาง ไม่ใช่เงินที่ลูกค้าจ่ายจริง
 *
 * ── จำนวนชิ้นนับเฉพาะบิลที่จ่ายแล้วในช่วงนั้น ────────────────────────────
 * **ต่างจากหน้า "สรุปวันนี้" โดยตั้งใจ** ซึ่งนับของที่ส่งเข้าครัวแล้ว เพราะมันตอบ
 * คำถาม "ตอนนี้ครัวทำอะไรไปแล้วบ้าง" ส่วนรายงานย้อนหลังตอบ "ช่วงนั้นขายอะไรไป
 * แล้วได้เงินเท่าไร" — ถ้านับของที่ยังไม่จ่าย ตารางเมนูกับยอดรายได้จะบวกไม่ตรงกัน
 * แล้วทั้งหน้าเชื่อไม่ได้
 *
 * ── ไฟล์นี้ไม่แปลภาษา ──────────────────────────────────────────────────
 * คืนตัวเลขกับชื่อที่ snapshot ไว้เท่านั้น ป้ายทุกอันเป็นหน้าที่ของหน้าจอ
 */

/** ต้องมีบรรทัดเสมอแม้ยอดเป็นศูนย์ — คนอ่านต้องเห็นว่า "ไม่มี" ไม่ใช่ "หาไม่เจอ" */
const REPORTED_METHODS: readonly PaymentMethod[] = ["CASH", "QR", "CARD"];

export type SalesReport = {
  revenue: number;
  billCount: number;
  averageBill: number;
  itemsSold: number;
  byDay: Array<{ day: string; revenue: number; billCount: number }>;
  byHour: Array<{ hour: number; revenue: number; billCount: number }>;
  byMethod: Array<{ method: PaymentMethod; total: number; count: number }>;
  byStaff: Array<{
    staffId: string | null;
    name: string | null;
    total: number;
    count: number;
    discountTotal: number;
  }>;
  byItem: Array<{ menuItemId: string; name: string; quantity: number; revenue: number }>;
};

export async function getSalesReport(
  branchId: string,
  range: ReportRange,
  timezone: string,
): Promise<SalesReport> {
  const window = branchDayRangeUtc(range.fromDay, range.toDay, timezone);

  if (!window?.gte || !window.lt) {
    // resolveReportRange() ตรวจรูปแบบมาแล้ว มาถึงตรงนี้ไม่ได้ในทางปฏิบัติ
    throw new Error(`ช่วงวันที่ใช้ไม่ได้: ${range.fromDay}..${range.toDay}`);
  }

  const payments = await prisma.payment.findMany({
    where: { branchId, paidAt: { gte: window.gte, lt: window.lt } },
    select: {
      id: true,
      method: true,
      grandTotal: true,
      discountAmount: true,
      paidAt: true,
      paidByStaffId: true,
      paidByStaff: { select: { name: true } },
      tableSessionId: true,
    },
  });

  const revenue = payments.reduce((sum, row) => sum + row.grandTotal, 0);
  const billCount = payments.length;

  return {
    revenue,
    billCount,
    // หารเมื่อมีบิลเท่านั้น — ไม่งั้นได้ NaN แล้วหน้าจอขึ้นคำว่า NaN ให้เจ้าของร้านอ่าน
    averageBill: billCount > 0 ? Math.floor(revenue / billCount) : 0,
    ...(await itemTotals(
      branchId,
      payments.map((row) => row.tableSessionId),
    )),
    byDay: bucketByDay(payments, timezone, range),
    byHour: bucketByHour(payments, timezone),
    byMethod: groupByMethod(payments),
    byStaff: groupByStaff(payments),
  };
}

function groupByMethod(
  payments: Array<{ method: PaymentMethod; grandTotal: number }>,
): SalesReport["byMethod"] {
  return REPORTED_METHODS.map((method) => {
    const rows = payments.filter((row) => row.method === method);
    return {
      method,
      count: rows.length,
      total: rows.reduce((sum, row) => sum + row.grandTotal, 0),
    };
  });
}

/**
 * แยกตามคน **รับเงิน** (`paidByStaffId`) ไม่ใช่คนกดสั่ง
 *
 * `paidByStaffId` เป็น null ได้ (SetNull ตอนลบพนักงาน) — ต้องมีแถว "ไม่ระบุ"
 * ไม่ใช่ทิ้งแถวนั้นหาย ไม่งั้นผลรวมของตารางนี้จะน้อยกว่ารายได้จริงโดยไม่มีใครเห็น
 */
function groupByStaff(
  payments: Array<{
    grandTotal: number;
    discountAmount: number;
    paidByStaffId: string | null;
    paidByStaff: { name: string } | null;
  }>,
): SalesReport["byStaff"] {
  const buckets = new Map<string, SalesReport["byStaff"][number]>();

  for (const row of payments) {
    const key = row.paidByStaffId ?? "";
    const bucket = buckets.get(key) ?? {
      staffId: row.paidByStaffId,
      name: row.paidByStaff?.name ?? null,
      total: 0,
      count: 0,
      discountTotal: 0,
    };

    bucket.total += row.grandTotal;
    bucket.count += 1;
    bucket.discountTotal += row.discountAmount;
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((a, b) => b.total - a.total);
}

/**
 * จัดกลุ่มตามวันของสาขา — ทำใน JS ไม่ใช่ `date_trunc` ของ Postgres
 *
 * เขตเวลาของสาขาเป็นข้อมูลในแอป (`Branch.timezone`) การ group ใน SQL ต้องส่งชื่อ
 * โซนเข้าไปแล้วหวังว่า tzdata ของ container ตรงกับของ Node — **สองแหล่งความจริง**
 *
 * เติมวันที่ไม่มียอดให้เป็น 0 ด้วย เพราะกราฟแท่งที่ข้ามวันที่ร้านปิดจะอ่านผิด
 * (ดูเหมือนขายทุกวันทั้งที่หยุดไปหนึ่งวัน)
 */
function bucketByDay(
  payments: Array<{ paidAt: Date; grandTotal: number }>,
  timezone: string,
  range: ReportRange,
): SalesReport["byDay"] {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  const totals = new Map<string, { revenue: number; billCount: number }>();

  for (const row of payments) {
    const day = format.format(row.paidAt);
    const bucket = totals.get(day) ?? { revenue: 0, billCount: 0 };
    bucket.revenue += row.grandTotal;
    bucket.billCount += 1;
    totals.set(day, bucket);
  }

  const days: SalesReport["byDay"] = [];
  const dayMs = 24 * 60 * 60 * 1000;

  for (
    let at = Date.parse(`${range.fromDay}T00:00:00Z`);
    at <= Date.parse(`${range.toDay}T00:00:00Z`);
    at += dayMs
  ) {
    const day = new Date(at).toISOString().slice(0, 10);
    days.push({ day, ...(totals.get(day) ?? { revenue: 0, billCount: 0 }) });
  }

  return days;
}

/** 24 ช่องเสมอ — ชั่วโมงที่ไม่มียอดต้องเห็นว่าเป็นศูนย์ ไม่ใช่หายไปจากแกน */
function bucketByHour(
  payments: Array<{ paidAt: Date; grandTotal: number }>,
  timezone: string,
): SalesReport["byHour"] {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  });

  const hours: SalesReport["byHour"] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    revenue: 0,
    billCount: 0,
  }));

  for (const row of payments) {
    const hour = Number(format.format(row.paidAt)) % 24;
    hours[hour].revenue += row.grandTotal;
    hours[hour].billCount += 1;
  }

  return hours;
}

/**
 * จำนวนชิ้นและยอดต่อเมนู จากรายการของบิลที่จ่ายแล้วในช่วงนั้น
 *
 * ใช้ `nameSnapshot` เป็นชื่อที่แสดง ไม่ join เมนูสด — ร้านเปลี่ยนชื่อเมนูแล้ว
 * รายงานเดือนที่แล้วต้องยังเรียกชื่อเดิม (กฎเดียวกับใบเสร็จบทที่ 12)
 * และเมื่อ id เดียวมีหลายชื่อในช่วงเดียวกัน **ใช้ชื่อของรายการที่ใหม่ที่สุด**
 * ไม่ใช่ตัวแรกที่เจอ ซึ่งขึ้นกับลำดับที่ฐานคืนมาแล้วเปลี่ยนไปมาได้
 */
async function itemTotals(
  branchId: string,
  sessionIds: string[],
): Promise<{ itemsSold: number; byItem: SalesReport["byItem"] }> {
  if (sessionIds.length === 0) {
    return { itemsSold: 0, byItem: [] };
  }

  const items = await prisma.orderItem.findMany({
    where: {
      branchId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      order: { tableSessionId: { in: sessionIds } },
    },
    select: {
      menuItemId: true,
      nameSnapshot: true,
      quantity: true,
      lineTotal: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const buckets = new Map<string, SalesReport["byItem"][number]>();
  let itemsSold = 0;

  for (const item of items) {
    itemsSold += item.quantity;

    const bucket = buckets.get(item.menuItemId) ?? {
      menuItemId: item.menuItemId,
      name: item.nameSnapshot,
      quantity: 0,
      revenue: 0,
    };

    // เรียงจากเก่าไปใหม่ ตัวหลังสุดจึงเป็นชื่อล่าสุดเสมอ
    bucket.name = item.nameSnapshot;
    bucket.quantity += item.quantity;
    bucket.revenue += item.lineTotal;
    buckets.set(item.menuItemId, bucket);
  }

  return {
    itemsSold,
    // เรียงมากไปน้อย — "ขายไม่ออก" คือหางของลิสต์เดียวกัน ไม่ต้องมี query ที่สอง
    byItem: [...buckets.values()].sort((a, b) => b.quantity - a.quantity),
  };
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm run smoke:reports`
Expected: PASS ทุกเคส · FAIL 0

- [ ] **Step 5: Commit**

```bash
git add lib/server/reports.ts scripts/smoke-reports.ts
git commit -m "Sales report aggregates: revenue, payment methods and per-staff totals"
```

---

### Task 3: เมนูขายดี — เคสที่พิสูจน์ว่านับเฉพาะบิลที่จ่ายแล้ว

**Files:**
- Modify: `scripts/smoke-reports.ts`

**Interfaces:**
- Consumes: `getSalesReport()` จาก Task 2 (มี `byItem`/`itemsSold` อยู่แล้ว)
- Produces: ไม่มีของใหม่ — Task นี้ปิดช่องว่างของเทสต์ที่ Task 2 ยังไม่ได้ครอบ

> Task 2 เขียน `itemTotals()` ไปแล้วเพราะมันอยู่ในฟังก์ชันเดียวกัน แต่ยัง **ไม่มี
> เทสต์ที่พิสูจน์กฎที่สำคัญที่สุดของมัน** คือ "นับเฉพาะบิลที่จ่ายแล้ว" — Task นี้เติม

- [ ] **Step 1: เขียนเคสที่ยังไม่ผ่าน**

ต่อใน `main()` ของ `scripts/smoke-reports.ts`:

```ts
  console.log("\n── เมนูขายดี ───────────────────────────────────────────────────\n");

  const itemRow = edged.byItem.find((row) => row.menuItemId === KRAPAO);
  check("เมนูที่ขายไปโผล่ในลิสต์", itemRow !== undefined);
  check(
    "จำนวนชิ้นรวมถูกต้อง (2 + 1 + 3 + 1 = 7 ชิ้นจากบิลที่อยู่ในช่วง)",
    itemRow?.quantity === 7,
    `${itemRow?.quantity}`,
  );
  check("ใช้ชื่อที่ snapshot ไว้ ไม่ใช่ join เมนูสด", typeof itemRow?.name === "string");
  check("itemsSold รวมเท่ากับผลรวมของลิสต์", edged.itemsSold === 7, `${edged.itemsSold}`);

  // ── บิลที่ยังไม่จ่ายต้องไม่ถูกนับ ──
  const openedForUnpaid = await openTableByStaff(cashier, table.id, 2);

  if (!openedForUnpaid.ok) {
    throw new Error(`เปิดโต๊ะไม่สำเร็จ: ${openedForUnpaid.errorKey}`);
  }

  const unpaidSession = await prisma.tableSession.findFirstOrThrow({
    where: { tableId: table.id, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  await addToCart({
    tableSessionId: unpaidSession.id,
    branchId,
    tableId: table.id,
    timezone,
    menuItemId: KRAPAO,
    quantity: 5,
    modifierIds: KRAPAO_OPTIONS,
    note: null,
  });
  await placeOrder(unpaidSession.id, { placedByStaffId: cashier.id });

  const withUnpaid = await getSalesReport(branchId, range, timezone);

  check(
    "ของในบิลที่ยังไม่จ่ายไม่ถูกนับ (ต่างจากหน้าสรุปวันนี้โดยตั้งใจ)",
    withUnpaid.itemsSold === 7,
    `${withUnpaid.itemsSold}`,
  );
  check("บิลที่ยังไม่จ่ายไม่ทำให้รายได้ขยับ", withUnpaid.revenue === edged.revenue);

  // ── รายการที่ถูกยกเลิกต้องไม่ถูกนับ ──
  const paidSession = await prisma.payment.findUniqueOrThrow({
    where: { id: a.paymentId },
    select: { tableSessionId: true },
  });

  await prisma.orderItem.updateMany({
    where: { order: { tableSessionId: paidSession.tableSessionId } },
    data: { status: "CANCELLED" },
  });

  const withCancelled = await getSalesReport(branchId, range, timezone);

  check(
    "รายการที่ถูกยกเลิกหายไปจากจำนวนชิ้น",
    withCancelled.itemsSold === 5,
    `${withCancelled.itemsSold}`,
  );
  check(
    "แต่เงินที่รับไปแล้วยังอยู่ในรายได้ (ยกเลิกรายการไม่ใช่การคืนเงิน)",
    withCancelled.revenue === edged.revenue,
  );

  console.log("\n── ล้างข้อมูลที่สร้างระหว่างทดสอบ ───────────────────────────────\n");

  await cleanup(branchId);
  check(
    "ล้างข้อมูลทดสอบหมดแล้ว",
    (await prisma.restaurantTable.count({ where: { branchId, name: TABLE_NAME } })) === 0,
  );
```

- [ ] **Step 2: รันเทสต์**

Run: `npm run smoke:reports`
Expected: PASS ทุกเคส · FAIL 0

ถ้าเคส "รายการที่ถูกยกเลิกหายไป" ไม่ผ่าน แปลว่า `itemTotals()` ลืมกรอง `CANCELLED`
— แก้ที่ `status: { notIn: ["DRAFT", "CANCELLED"] }` ใน `lib/server/reports.ts`

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-reports.ts
git commit -m "Pin the rule that item counts follow paid bills only"
```

---

### Task 4: จอ `/admin/reports`

**Files:**
- Create: `app/(admin)/admin/reports/page.tsx` ·
  `app/(admin)/admin/reports/_components/range-picker.tsx`
- Modify: `lib/rbac.ts` · `app/(admin)/admin/page.tsx` · `lib/i18n/vi.ts` · `lib/i18n/en.ts`

**Interfaces:**
- Consumes: `getSalesReport()` · `resolveReportRange()` · `REPORT_PRESETS`
- Produces: `canViewReports(role: StaffRole): boolean`

- [ ] **Step 1: เพิ่มสิทธิ์**

ต่อท้าย `lib/rbac.ts`:

```ts
/**
 * เปิดหน้ารายงานยอดขายย้อนหลัง (spec §18)
 *
 * ชุดเดียวกับ `canBrowseReceipts` / `canViewShiftHistory` — รายงานเปิดยอดขาย
 * ทั้งสาขาและยอดต่อพนักงานรายคน ซึ่งเป็นข้อมูลของเจ้าของร้าน ไม่ใช่ของคนขาย
 */
export function canViewReports(role: StaffRole): boolean {
  return role === "OWNER" || role === "MANAGER";
}
```

- [ ] **Step 2: เพิ่มคีย์ข้อความสองภาษา**

ใน `lib/i18n/vi.ts` ต่อจาก `"admin.shifts.link"`:

```ts
  "admin.reports.title": "Báo cáo bán hàng",
  "admin.reports.link": "Xem báo cáo bán hàng theo khoảng ngày",
  "admin.reports.preset.today": "Hôm nay",
  "admin.reports.preset.yesterday": "Hôm qua",
  "admin.reports.preset.last7": "7 ngày qua",
  "admin.reports.preset.month": "Tháng này",
  "admin.reports.from": "Từ ngày",
  "admin.reports.to": "Đến ngày",
  "admin.reports.apply": "Xem",
  "admin.reports.export": "Tải CSV",
  "admin.reports.revenue": "Doanh thu",
  "admin.reports.bills": "Số hóa đơn",
  "admin.reports.averageBill": "Trung bình mỗi hóa đơn",
  "admin.reports.itemsSold": "Số món đã bán",
  "admin.reports.byDay": "Theo ngày",
  "admin.reports.byHour": "Theo giờ trong ngày",
  "admin.reports.byItem": "Món bán chạy",
  "admin.reports.byStaff": "Theo nhân viên",
  "admin.reports.byMethod": "Theo hình thức thanh toán",
  "admin.reports.unassigned": "Không xác định",
  "admin.reports.discountGiven": "Giảm giá đã cho",
  "admin.reports.paidOnly": "Chỉ tính những hóa đơn đã thanh toán trong khoảng này",
  "admin.reports.notYet": "Chưa có giá vốn, lợi nhuận và tồn kho — cần giá vốn món và chương 14",
  "admin.reports.empty": "Khoảng này chưa có hóa đơn nào",
```

ใน `lib/i18n/en.ts` ต่อจากคีย์เดียวกัน:

```ts
  "admin.reports.title": "Sales reports",
  "admin.reports.link": "Open sales reports by date range",
  "admin.reports.preset.today": "Today",
  "admin.reports.preset.yesterday": "Yesterday",
  "admin.reports.preset.last7": "Last 7 days",
  "admin.reports.preset.month": "This month",
  "admin.reports.from": "From",
  "admin.reports.to": "To",
  "admin.reports.apply": "Show",
  "admin.reports.export": "Download CSV",
  "admin.reports.revenue": "Revenue",
  "admin.reports.bills": "Bills",
  "admin.reports.averageBill": "Average bill",
  "admin.reports.itemsSold": "Items sold",
  "admin.reports.byDay": "By day",
  "admin.reports.byHour": "By hour of day",
  "admin.reports.byItem": "Best sellers",
  "admin.reports.byStaff": "By staff member",
  "admin.reports.byMethod": "By payment method",
  "admin.reports.unassigned": "Unassigned",
  "admin.reports.discountGiven": "Discounts given",
  "admin.reports.paidOnly": "Counts only bills paid inside this range",
  "admin.reports.notYet": "No cost, profit or stock figures yet — those need item cost prices and chapter 14",
  "admin.reports.empty": "No bills were paid in this range",
```

- [ ] **Step 3: ฟอร์มเลือกช่วง (client)**

สร้าง `app/(admin)/admin/reports/_components/range-picker.tsx`:

```tsx
"use client";

import Link from "next/link";

import { useT } from "@/components/i18n-provider";
import { REPORT_PRESETS, type ReportRange } from "@/lib/report-range";

/**
 * ตัวเลือกช่วงเวลา — เขียนลง URL ไม่ใช่ state ในหน้า
 *
 * เพราะหน้านี้ต้องส่งลิงก์ให้กันได้ และ **ปุ่มส่งออก CSV ใช้พารามิเตอร์ชุดเดียวกัน**
 * ถ้าเก็บใน state ปุ่มส่งออกจะต้องรู้ state นั้นด้วย ซึ่งเป็นสองแหล่งความจริงทันที
 *
 * preset เป็น `<Link>` ธรรมดา ไม่ใช่ปุ่มที่ยิง action — การเปลี่ยนช่วงคือการเปิด
 * URL อื่น ไม่ใช่การกระทำที่เปลี่ยนข้อมูล
 */
export function RangePicker({ range, exportHref }: { range: ReportRange; exportHref: string }) {
  const { t } = useT();

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2">
        {REPORT_PRESETS.map((preset) => (
          <Link
            key={preset}
            href={`/admin/reports?preset=${preset}`}
            className="btn btn-secondary h-10 px-3 text-[14px]"
          >
            {t(`admin.reports.preset.${preset}`)}
          </Link>
        ))}
      </div>

      <form action="/admin/reports" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="kicker">{t("admin.reports.from")}</span>
          <input
            type="date"
            name="from"
            defaultValue={range.fromDay}
            className="input h-11 px-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">{t("admin.reports.to")}</span>
          <input type="date" name="to" defaultValue={range.toDay} className="input h-11 px-2" />
        </label>

        <button type="submit" className="btn btn-primary h-11 px-4 text-[14px]">
          {t("admin.reports.apply")}
        </button>

        {/*
          ดาวน์โหลดเป็น <a> ธรรมดาไปที่ Route Handler — Server Action คืนไฟล์ให้
          เบราว์เซอร์ดาวน์โหลดตรง ๆ ไม่ได้ (ดู spec §7)
        */}
        <a href={exportHref} className="btn btn-secondary h-11 px-4 text-[14px]">
          {t("admin.reports.export")}
        </a>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: หน้า `/admin/reports`**

สร้าง `app/(admin)/admin/reports/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { formatMoney } from "@/lib/money";
import { paymentMethodKey } from "@/lib/payment-method";
import { canAccessScreen, canViewReports } from "@/lib/rbac";
import { resolveReportRange } from "@/lib/report-range";
import { getT, type Translator } from "@/lib/server/locale";
import { getSalesReport } from "@/lib/server/reports";
import { getCurrentStaff } from "@/lib/server/staff-session";
import type { Currency } from "@/lib/generated/prisma/enums";

import { RangePicker } from "./_components/range-picker";

/**
 * รายงานยอดขายย้อนหลัง (spec §18)
 *
 * หน้าเดียวสี่ส่วนเรียงลงมา ไม่ใช่สี่หน้า — ผู้จัดการต้องกวาดตาทีเดียวจบแล้วกดส่งออก
 *
 * **ไม่ใช้ไลบรารีกราฟ** แถบสัดส่วนวาดด้วย `div` กว้างเป็น % ซึ่งพอสำหรับคำถาม
 * "วันไหน/ชั่วโมงไหนขายดี" และไม่ต้องแบก dependency ที่ต้องดูแลธีม/ภาษา/ขนาดจอเอง
 */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  // ตำแหน่งที่เข้าไม่ได้ถูกพากลับไปหน้าที่ทำงานได้ (กติกาเดียวกับสรุปวันนี้/ประวัติกะ)
  if (!canViewReports(staff.role)) {
    redirect("/admin/menu");
  }

  const params = await searchParams;
  const i18n = await getT();
  const { t } = i18n;
  const currency = staff.branch.currency;
  const timezone = staff.branch.timezone;

  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const resolved = resolveReportRange({ ...params, todayYmd });

  if (!resolved.ok) {
    return (
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 lg:p-8">
        <h1 className="display text-[26px]">{t("admin.reports.title")}</h1>
        <p role="alert" className="alert">
          {t(resolved.errorKey, { days: 92 })}
        </p>
      </main>
    );
  }

  const range = resolved.range;
  const report = await getSalesReport(staff.branchId, range, timezone);
  const exportHref = `/admin/reports/export?type=sales&from=${range.fromDay}&to=${range.toDay}`;

  const money = (amount: number) => formatMoney(amount, currency);
  const peakDay = Math.max(1, ...report.byDay.map((row) => row.revenue));
  const peakHour = Math.max(1, ...report.byHour.map((row) => row.revenue));

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="display text-[26px]">{t("admin.reports.title")}</h1>
        <p className="kicker">
          {range.fromDay} — {range.toDay}
        </p>
      </div>

      <RangePicker range={range} exportHref={exportHref} />

      <p className="kicker">{t("admin.reports.paidOnly")}</p>

      {report.billCount === 0 ? (
        <p className="panel p-6">{t("admin.reports.empty")}</p>
      ) : (
        <>
          <div className="ink-grid ink-grid-sparse grid-cols-2 lg:grid-cols-4">
            <Stat label={t("admin.reports.revenue")} value={money(report.revenue)} />
            <Stat label={t("admin.reports.bills")} value={String(report.billCount)} />
            <Stat label={t("admin.reports.averageBill")} value={money(report.averageBill)} />
            <Stat label={t("admin.reports.itemsSold")} value={String(report.itemsSold)} />
          </div>

          <Section title={t("admin.reports.byDay")}>
            {report.byDay.map((row) => (
              <Bar
                key={row.day}
                label={row.day}
                value={money(row.revenue)}
                ratio={row.revenue / peakDay}
              />
            ))}
          </Section>

          <Section title={t("admin.reports.byHour")}>
            {report.byHour
              .filter((row) => row.billCount > 0)
              .map((row) => (
                <Bar
                  key={row.hour}
                  label={`${String(row.hour).padStart(2, "0")}:00`}
                  value={money(row.revenue)}
                  ratio={row.revenue / peakHour}
                />
              ))}
          </Section>

          <Section title={t("admin.reports.byItem")}>
            {report.byItem.map((row) => (
              <Line
                key={row.menuItemId}
                label={`${row.name} × ${row.quantity}`}
                value={money(row.revenue)}
              />
            ))}
          </Section>

          <Section title={t("admin.reports.byStaff")}>
            {report.byStaff.map((row) => (
              <Line
                key={row.staffId ?? "unassigned"}
                label={row.name ?? t("admin.reports.unassigned")}
                value={money(row.total)}
                hint={`${t("admin.reports.discountGiven")} ${money(row.discountTotal)}`}
              />
            ))}
          </Section>

          <Section title={t("admin.reports.byMethod")}>
            {report.byMethod.map((row) => (
              <Line
                key={row.method}
                label={t(paymentMethodKey(row.method))}
                value={money(row.total)}
                hint={String(row.count)}
              />
            ))}
          </Section>
        </>
      )}

      {/* บอกตรง ๆ ว่าอะไรยังไม่มีและเพราะอะไร ดีกว่าคอลัมน์ที่เป็น 0 ตลอดกาล */}
      <p className="kicker">{t("admin.reports.notYet")}</p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-[var(--color-bg)] p-5">
      <span className="kicker">{label}</span>
      <span className="display text-[26px] tabular-nums">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel flex flex-col gap-2 p-5">
      <h2 className="kicker">{title}</h2>
      {children}
    </section>
  );
}

function Bar({ label, value, ratio }: { label: string; value: string; ratio: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="kicker w-[86px] flex-none tabular-nums">{label}</span>
      <span className="h-3 flex-1 bg-[var(--color-neutral-200)]">
        <span
          className="block h-full bg-[var(--color-accent)]"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
      <span className="display w-[110px] flex-none text-right text-[14px] tabular-nums">
        {value}
      </span>
    </div>
  );
}

function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="min-w-0">{label}</span>
      <span className="flex items-baseline gap-3">
        {hint ? <span className="kicker">{hint}</span> : null}
        <span className="display tabular-nums">{value}</span>
      </span>
    </div>
  );
}
```

`Currency` กับ `Translator` ถูก import ไว้สำหรับ helper ที่อาจแยกออกไป — ถ้า
`eslint` ฟ้องว่าไม่ได้ใช้ ให้ลบสองบรรทัดนั้นทิ้ง **อย่าปิดกฎ lint**

- [ ] **Step 5: ทางเข้าจากหน้าสรุปวันนี้**

ใน `app/(admin)/admin/page.tsx` ใต้ลิงก์ประวัติกะ:

```tsx
          <Link href="/admin/reports" className="kicker">
            {t("admin.reports.link")} ›
          </Link>
```

- [ ] **Step 6: ตรวจ**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: ไม่มี error

- [ ] **Step 7: Commit**

```bash
git add lib/rbac.ts lib/i18n "app/(admin)/admin/reports" "app/(admin)/admin/page.tsx"
git commit -m "Sales report screen with a URL-driven date range"
```

---

### Task 5: ส่งออก CSV

**Files:**
- Create: `app/(admin)/admin/reports/export/route.ts`
- Modify: `scripts/smoke-reports.ts`

**Interfaces:**
- Consumes: `getSalesReport()` · `resolveReportRange()` · `toCsv()` · `csvFileName()` ·
  `amountHeader()` · `canViewReports()`
- Produces: `GET /admin/reports/export?type=&from=&to=` → `text/csv`

- [ ] **Step 1: เขียน Route Handler**

สร้าง `app/(admin)/admin/reports/export/route.ts`:

```ts
import { csvFileName, toCsv, amountHeader } from "@/lib/csv";
import { canAccessScreen, canViewReports } from "@/lib/rbac";
import { resolveReportRange } from "@/lib/report-range";
import { getT } from "@/lib/server/locale";
import { getSalesReport } from "@/lib/server/reports";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * ส่งออกรายงานเป็น CSV (spec §19)
 *
 * ── ทำไมเป็น Route Handler ไม่ใช่ Server Action ─────────────────────────
 * action คืนค่าให้ React ไม่ได้คืน "ไฟล์ที่เบราว์เซอร์ต้องดาวน์โหลด" —
 * การดาวน์โหลดต้องมี response จริงที่มี `Content-Disposition`
 *
 * ── ต้องตรวจสิทธิ์ในไฟล์นี้เอง ──────────────────────────────────────────
 * URL นี้ยิงตรงได้จากแถบที่อยู่ **การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์**
 * ตอบ 403 ไม่ใช่ redirect เพราะปลายทางเป็นไฟล์ ไม่ใช่หน้า HTML
 */
export async function GET(request: Request) {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin") || !canViewReports(staff.role)) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const timezone = staff.branch.timezone;
  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

  const resolved = resolveReportRange({
    preset: url.searchParams.get("preset"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    todayYmd,
  });

  if (!resolved.ok) {
    return new Response(resolved.errorKey, { status: 400 });
  }

  const { t } = await getT();
  const range = resolved.range;
  const currency = staff.branch.currency;
  const report = await getSalesReport(staff.branchId, range, timezone);
  const type = url.searchParams.get("type") ?? "sales";

  /**
   * ยอดเงินในไฟล์เป็น **จำนวนเต็มหน่วยย่อยดิบ** ไม่ใช่สตริงที่จัดรูปแล้ว —
   * สเปรดชีตต้องบวกคอลัมน์นั้นได้ ส่วนการจัดรูปเป็นเรื่องของหน้าจอ
   * ชื่อคอลัมน์จึงแนบสกุลเงินไว้ด้วยเพื่อให้คนอ่านรู้ว่าหน่วยคืออะไร
   */
  const rows: (string | number | null)[][] = [];

  if (type === "byDay") {
    rows.push([t("admin.reports.byDay"), amountHeader(t("admin.reports.revenue"), currency), t("admin.reports.bills")]);
    for (const row of report.byDay) {
      rows.push([row.day, row.revenue, row.billCount]);
    }
  } else if (type === "byHour") {
    rows.push([t("admin.reports.byHour"), amountHeader(t("admin.reports.revenue"), currency), t("admin.reports.bills")]);
    for (const row of report.byHour) {
      rows.push([`${String(row.hour).padStart(2, "0")}:00`, row.revenue, row.billCount]);
    }
  } else if (type === "products") {
    rows.push([t("admin.reports.byItem"), t("admin.reports.itemsSold"), amountHeader(t("admin.reports.revenue"), currency)]);
    for (const row of report.byItem) {
      rows.push([row.name, row.quantity, row.revenue]);
    }
  } else if (type === "staff") {
    rows.push([
      t("admin.reports.byStaff"),
      t("admin.reports.bills"),
      amountHeader(t("admin.reports.revenue"), currency),
      amountHeader(t("admin.reports.discountGiven"), currency),
    ]);
    for (const row of report.byStaff) {
      rows.push([row.name ?? t("admin.reports.unassigned"), row.count, row.total, row.discountTotal]);
    }
  } else if (type === "payments") {
    rows.push([t("admin.reports.byMethod"), t("admin.reports.bills"), amountHeader(t("admin.reports.revenue"), currency)]);
    for (const row of report.byMethod) {
      rows.push([row.method, row.count, row.total]);
    }
  } else {
    rows.push([t("admin.reports.title"), amountHeader(t("admin.reports.revenue"), currency)]);
    rows.push([t("admin.reports.revenue"), report.revenue]);
    rows.push([t("admin.reports.bills"), report.billCount]);
    rows.push([t("admin.reports.averageBill"), report.averageBill]);
    rows.push([t("admin.reports.itemsSold"), report.itemsSold]);
  }

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(type, range)}"`,
      // รายงานเปลี่ยนทุกครั้งที่มีบิลใหม่ — แคชไฟล์นี้ไว้แปลว่าส่งเลขเก่าให้เจ้าของร้าน
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: ตรวจด้วยเซิร์ฟเวอร์จริง**

```bash
npm run build && npm run start -- -p 3002
npm run dev:staff-cookie 001 admin
```

```bash
export MSYS_NO_PATHCONV=1
curl -s -D- -o /tmp/report.csv \
  -H "Cookie: admin_staff_session=<token>" \
  "http://localhost:3002/admin/reports/export?type=products&preset=today" | head -5
head -3 /tmp/report.csv | xxd | head -2
```

Expected: `200` · `Content-Type: text/csv` · `Content-Disposition: attachment` ·
ไบต์สามตัวแรกของไฟล์เป็น `ef bb bf` (BOM)

ยิงซ้ำโดยไม่ใส่ cookie:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3002/admin/reports/export?type=products"
```

Expected: `403`

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/reports/export"
git commit -m "CSV export route with its own permission check"
```

---

### Task 6: ตรวจครบชุด + วัดจอ + เอกสาร

**Files:**
- Create: `archive/report/2026-09-12-reports.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: ตรวจครบ**

```bash
npm run typecheck && npm run lint && npm run build
for s in order pos kds bill payment menu receipt staff-meal takeaway staff-session \
         staff-admin settings dashboard table-move tables i18n shift reports; do
  echo -n "$s: "; npm run --silent smoke:$s 2>&1 | grep -cE "^FAIL"
done
```

Expected: **สิบแปดชุด FAIL 0 ทุกชุด**

- [ ] **Step 2: วัดจอสองภาษา**

เตรียมข้อมูลให้ช่วงที่วัดมีบิลจริงก่อน (ไม่งั้นหน้าจะขึ้น "ยังไม่มีบิล" แล้ว
`mustSee` หาไม่เจอ ซึ่งเป็นคนละเรื่องกับจอพัง) แล้ว:

```bash
npm run build && npm run start -- -p 3002
npm run dev:staff-cookie 001 admin
```

ใช้ตัวรัน `run-audit.mjs` (วนสองภาษา) กับ config:

```json
{"cookies":[{"name":"admin_staff_session","value":"<token>"}],
 "pages":[
  {"path":"/admin/reports","mustSee":{"vi":["Doanh thu","Theo nhân viên"],"en":["Revenue","By staff member"]}},
  {"path":"/admin/reports?preset=month","mustSee":{"vi":["Theo giờ trong ngày"],"en":["By hour of day"]}}
 ]}
```

Expected: 20/20 (2 หน้า × 5 ขนาด × 2 ภาษา)

- [ ] **Step 3: เขียนรายงาน**

`archive/report/2026-09-12-reports.md` — สร้างอะไร · กับดักที่เจอ · เลขที่วัดได้จริง ·
อะไรที่ตั้งใจไม่ทำ (ต้นทุน/กำไร/สต็อก/Excel/PDF พร้อมเหตุผล)

- [ ] **Step 4: อัปเดต `CLAUDE.md`**

เพิ่มหัวข้อใต้หัวข้อ 6 ครอบ:
- **ยอดเงินมาจาก `Payment` · จำนวนชิ้นมาจากบิลที่จ่ายแล้วในช่วงนั้น** และ
  **ต่างจากหน้าสรุปวันนี้โดยตั้งใจ** (สรุปวันนี้นับของที่ส่งเข้าครัว)
- **จัดกลุ่มวัน/ชั่วโมงใน JS ไม่ใช่ SQL** เพราะเขตเวลาอยู่ในแอป · เพดาน 92 วัน
  **ห้ามเพิ่มตัวเลขนี้เฉย ๆ** ต้องย้ายไป SQL ก่อน
- **CSV ต้องมี BOM** ไม่งั้น Excel อ่านภาษาเวียดนามเป็นขยะ · ยอดเงินในไฟล์เป็น
  จำนวนเต็มดิบ + บอกสกุลที่ชื่อคอลัมน์
- **ส่งออกเป็น Route Handler ที่ตรวจสิทธิ์เอง ตอบ 403 ไม่ใช่ redirect**
- `canViewReports` = OWNER/MANAGER · ทางเข้าคือลิงก์จากสรุปวันนี้ **ไม่เพิ่มโมดูลที่เจ็ด**
- อัปเดตจำนวน smoke เป็นสิบแปดชุด

- [ ] **Step 5: Commit**

```bash
git add archive/report/2026-09-12-reports.md CLAUDE.md
git commit -m "Chapter: sales reports — verification, report and CLAUDE.md"
```

---

## Self-Review

**Spec coverage.** §1 เป้าหมายสี่ข้อ → Task 2 (ขาย/ช่องทาง/พนักงาน) + Task 3 (เมนู) ·
§3 ของที่ทำไม่ได้ → เขียนบนจอที่ Task 4 Step 2 (`admin.reports.notYet`) ·
§4.1 → Task 2 · §4.2 → Task 2 (`itemTotals`) + Task 3 (เทสต์) · §4.3 → Task 2
(`bucketByDay`/`bucketByHour`) · §5 ช่วงเวลา → Task 1 · §6 โมดูล → ครบทุกไฟล์ ·
§7 CSV → Task 1 (`toCsv`) + Task 5 (route) · §8 จอ → Task 4 · §9 เทสต์ 14 เคส →
Task 1 (1-6, 12-14) + Task 2 (1-5, 10) + Task 3 (7-9) + Task 5 (11 ผ่าน 403) ·
§10 → Task 6. **ไม่มีช่องว่าง**

**Placeholder scan.** ไม่มี TBD/TODO · ทุกขั้นที่ต้องเขียนโค้ดมีโค้ดจริง ·
ขั้นที่บอกให้ "เขียนรายงาน" (Task 6 Step 3) ระบุหัวข้อที่ต้องมีครบแล้ว

**Type consistency.** `ReportRange` มี `fromDay`/`toDay` เหมือนกันทุก Task ·
`resolveReportRange()` คืน `{ok,range}` / `{ok:false,errorKey}` ตรงกันทั้ง Task 1, 4, 5 ·
`getSalesReport(branchId, range, timezone)` รับสามพารามิเตอร์เท่ากันทั้ง Task 2, 4, 5 ·
`toCsv(rows)` รับ array ของ array เหมือนกันทั้ง Task 1 และ 5 ·
`canViewReports` ชื่อเดียวกันทั้ง Task 4 และ 5

**ข้อควรระวังที่ฝังไว้แล้ว:** เทสต์ขอบช่วงใน Task 2 **จงใจไม่ใช้**
`startOfBranchDayUtc()` ตัวเดียวกับโค้ดจริง เพราะถ้าใช้ เทสต์จะผ่านเสมอแม้ฟังก์ชันนั้นผิด
