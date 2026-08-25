# ย้ายโต๊ะ / รวมโต๊ะ — Implementation Plan

> **สำหรับคนที่ลงมือ (คนหรือ agent):** ทำทีละ Task ตามลำดับ ทุก Task จบด้วย commit
> และของที่ทดสอบได้เอง · ช่องติ๊ก `- [ ]` ใช้ติดตามความคืบหน้า

**Goal:** พนักงานย้ายรอบขายทั้งชุดไปโต๊ะอื่น และรวมสองโต๊ะเป็นบิลเดียวได้ โดยยอดเงิน
ไม่เพี้ยนและตรวจสอบย้อนหลังได้

**Architecture:** การย้ายคือการอัปเดต `Order.tableSessionId` + `Order.tableId` ของทั้งชุด
ในทรานแซกชันเดียว การรวมคือการย้ายแบบเดียวกันแล้วปิดรอบต้นทางเป็น `MERGED` พร้อมชี้
`mergedIntoSessionId` ไปรอบปลายทาง ชั้นคิดเงิน/รับเงิน/ใบเสร็จ/KDS ไม่ถูกแตะเลย

**Tech Stack:** Next.js 16.2 (App Router) · Prisma 7 (`prisma-client` generator +
`@prisma/adapter-pg`) · PostgreSQL 17 ใน Docker · smoke test เป็นสคริปต์ `tsx --conditions=react-server`

**Spec:** `report/2026-08-24-plan-table-move-merge.md` — อ่านคู่กันเสมอ แผนนี้เถียงจาก spec นั้น

## Global Constraints

- เงินเป็น `Int` หน่วยย่อยของสกุลเงินสาขา · **ห้ามหาร 100 นอก `lib/money.ts`** · ห้าม float
- ทุก query กรอง `staff.branchId` เสมอ
- ไฟล์ใน `lib/server/` ขึ้นต้นด้วย `import "server-only"`
- ไฟล์ `"use server"` export ได้เฉพาะ async function
- `publishRealtimeEvent()` เรียก **หลัง** commit ห้ามเรียกใน `$transaction`
- แก้หลายตารางพร้อมกัน = `$transaction` เดียว
- **รัน `prisma generate`/`migrate` ขณะ `npm run dev` เปิดอยู่ = ต้องรีสตาร์ท dev server**
- import Prisma client จาก `@/lib/generated/prisma/client` ไม่ใช่ `@prisma/client`
- ป้ายบนหน้าจอเป็นภาษาไทย · ห้ามเขียน "฿" ตรง ๆ ใช้ `formatMoney(amount, currency)`
- อะไรที่เพิ่มในโซน `flex-none` ของแพเนลที่มีโซน `overflow-auto` จะไปกินพื้นที่โซนนั้น

**การแก้ spec หนึ่งข้อระหว่างเขียนแผน:** `mergedIntoSessionId` ใช้ `onDelete: SetNull`
ไม่ใช่ `Restrict` — ถ้าเป็น Restrict ทุกสคริปต์ที่ล้างรอบโต๊ะ (`dev:reset-table` + smoke
ทุกชุด) ต้องเพิ่มลำดับการลบอีกชั้น ซึ่งเป็นหนี้ที่จ่ายทุกก้อนต่อจากนี้ · โซ่นี้เป็น
"ตัวช่วยพาลูกค้าไปรอบปลายทาง + อ่านประวัติง่าย" ส่วนหลักฐานจริงของการรวมอยู่ใน `AuditLog`
ซึ่งเป็นตารางที่เขียนอย่างเดียวและไม่มีใครลบ

---

## File Structure

| ไฟล์ | ความรับผิดชอบ |
|---|---|
| `prisma/schema.prisma` (แก้) | ค่า enum `MERGED` + คอลัมน์ `mergedIntoSessionId` |
| `lib/rbac.ts` (แก้) | `canMoveTableSession()` |
| `lib/audit-log.ts` (แก้) | ป้ายไทยของ action `table_session.move` / `.merge` |
| **`lib/server/table-move.ts` (ใหม่)** | ตรรกะย้าย/รวมทั้งหมด — leaf module ไม่มีใครใน `lib/server/` import กลับ |
| `lib/server/pos.ts` (แก้) | `getMoveTargets()` — รายชื่อโต๊ะปลายทางพร้อมยอดปัจจุบัน |
| `lib/server/table-session.ts` (แก้) | `resolveCustomerContext()` เดินตามโซ่ merge |
| `app/(pos)/pos/actions.ts` (แก้) | `moveTableAction` / `mergeTableAction` |
| `app/(pos)/pos/_components/table-actions.tsx` (แก้) | ฟอร์มเลือกโต๊ะปลายทาง |
| `app/(pos)/pos/_components/sale-point-screen.tsx` (แก้) | วางฟอร์มในโซนที่เลื่อนได้ |
| `app/(customer)/t/[tableCode]/page.tsx` (แก้) | ป้าย "โต๊ะนี้ถูกรวมไปที่ …" |
| **`scripts/smoke-table-move.ts` (ใหม่)** | smoke suite ชุดที่ 14 |
| `package.json` (แก้) | `smoke:table-move` |

**โต๊ะที่ smoke ชุดนี้ใช้: สร้างเองสองโต๊ะ (`MV-SRC`, `MV-DST`) แล้วลบทิ้งตอนจบ**
ไม่ยืมโต๊ะ seed เพราะ A1/A3/B1/B2 ถูกชุดอื่นใช้อยู่แล้วและเหลือโต๊ะนั่งแค่ 5 ตัว

---

### Task 1: schema + migration + ไล่ตรวจ query ที่ถามสถานะรอบ

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_table_session_merge/migration.sql` (Prisma สร้างให้)

**Interfaces:**
- Consumes: —
- Produces: `TableSessionStatus.MERGED` · `TableSession.mergedIntoSessionId: string | null`
  · relation `mergedInto` / `mergedFrom`

- [x] **Step 1: เพิ่มค่า enum**

ใน `prisma/schema.prisma` ที่ `enum TableSessionStatus`:

```prisma
enum TableSessionStatus {
  OPEN
  CLOSED
  ABANDONED
  /// ถูกกลืนเข้ากับรอบอื่นตอน "รวมโต๊ะ" — ไม่ใช่รอบขายที่เกิดขึ้นจริง
  /// รายงานบทที่ 15 ต้องไม่นับค่านี้เป็นหนึ่งรอบขาย ไม่งั้นจำนวนบิลจะเกินความจริง
  MERGED
}
```

- [x] **Step 2: เพิ่มคอลัมน์และ self-relation**

ใน `model TableSession` วางต่อจากบล็อก `customerName`:

```prisma
  // ── รวมโต๊ะ ────────────────────────────────────────────────────────────
  //
  // รอบที่ถูกกลืนจะ **ไม่มีออร์เดอร์เหลืออยู่เลย** (ย้ายไปรอบปลายทางหมดแล้ว)
  // เก็บตัวชี้ไว้เพื่อสองอย่าง: พามือถือลูกค้าที่ยังถือ cookie ของรอบนี้ไปยัง
  // รอบปลายทาง และตอบคำถาม "ของโต๊ะนี้ไปรวมที่ไหน" โดยไม่ต้องขุด AuditLog
  //
  // SetNull ไม่ใช่ Restrict: หลักฐานจริงของการรวมอยู่ใน AuditLog อยู่แล้ว
  // ถ้าใช้ Restrict ทุกสคริปต์ที่ล้างรอบโต๊ะต้องเพิ่มลำดับการลบอีกชั้นตลอดไป

  /// รอบที่กลืนรอบนี้ไป — null เสมอสำหรับรอบปกติ **และสำหรับการ "ย้ายโต๊ะ"**
  /// (การย้ายไม่สร้างรอบใหม่ รอบเดิมแค่เปลี่ยน tableId จึงไม่มีโซ่ให้เดิน)
  mergedIntoSessionId String?

  mergedInto TableSession?  @relation("SessionMerge", fields: [mergedIntoSessionId], references: [id], onDelete: SetNull)
  mergedFrom TableSession[] @relation("SessionMerge")
```

และเพิ่ม index ท้ายโมเดล (Postgres ไม่สร้าง index ให้ FK เอง):

```prisma
  @@index([mergedIntoSessionId])
```

- [x] **Step 3: สร้างและ apply migration**

```bash
npx prisma migrate dev --name table_session_merge
```

Expected: `Your database is now in sync with your schema.` และมีโฟลเดอร์
`prisma/migrations/<timestamp>_table_session_merge/`
**ถ้า `npm run dev` เปิดค้างอยู่ ให้รีสตาร์ททันทีหลังคำสั่งนี้**

- [x] **Step 4: ไล่ตรวจทุก query ที่ถามสถานะรอบ**

การเพิ่มค่า enum ตัวที่สี่เปลี่ยนความหมายของเงื่อนไขที่เขียนแบบ "ไม่ใช่ X" ทันที
และ **tsc ไม่ฟ้องเลย** เพราะยังเป็นค่าที่ถูกชนิด:

```bash
grep -rn "TableSessionStatus\|status: \"OPEN\"\|status: \"CLOSED\"\|status: \"ABANDONED\"" \
  lib app scripts --include=*.ts --include=*.tsx | grep -v node_modules
```

เดินทีละบรรทัดแล้วตอบให้ได้ว่า "ถ้ามีแถวสถานะ `MERGED` โผล่มา บรรทัดนี้ยังถูกไหม":

- เงื่อนไขที่เขียน `status: "OPEN"` ตรง ๆ → **ปลอดภัย** ไม่ต้องแก้ (รอบที่ถูกกลืนไม่ OPEN แล้ว)
- เงื่อนไขที่เขียน `not: "OPEN"` หรือ `in: ["CLOSED", "ABANDONED"]` → **ต้องตัดสินใจ**
  ว่านับรอบที่ถูกกลืนด้วยหรือไม่ แล้วเขียนให้ชัด
- จุดที่ต้องดูอย่างน้อย: `lib/server/pos.ts` · `lib/server/billing.ts` ·
  `lib/server/payment.ts` · `lib/server/dashboard.ts` · `lib/server/table-session.ts`

เขียนสิ่งที่ตรวจเจอเป็นคอมเมนต์สั้น ๆ ตรงบรรทัดที่ต้องแก้ ถ้าไม่มีอะไรต้องแก้เลย
ให้บันทึกไว้ใน commit message ว่าไล่ตรวจแล้วกี่จุด

- [x] **Step 5: ยืนยันว่าของเดิมไม่พัง**

```bash
npx tsc --noEmit
for s in order pos kds bill payment menu receipt staff-meal takeaway staff-session staff-admin settings dashboard; do
  npm run --silent smoke:$s > /dev/null 2>&1 || echo "FAILED: $s"
done
```

Expected: tsc เงียบ และไม่มีบรรทัด `FAILED:` เลย (13 ชุดเดิมยังผ่านครบ)

- [x] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): TableSessionStatus.MERGED + mergedIntoSessionId สำหรับรวมโต๊ะ"
```

---

### Task 2: `moveTableSession()` — ย้ายทั้งรอบไปโต๊ะว่าง

**Files:**
- Create: `lib/server/table-move.ts`
- Create: `scripts/smoke-table-move.ts`
- Modify: `lib/rbac.ts` · `lib/audit-log.ts` · `package.json`

**Interfaces:**
- Consumes: `CurrentStaff` จาก `@/lib/server/staff-session` · `prisma` จาก `@/lib/server/db`
- Produces:
  - `canMoveTableSession(role: StaffRole): boolean`
  - `moveTableSession(staff: CurrentStaff, input: { sessionId: string; targetTableId: string }): Promise<{ ok: true; movedOrders: number } | { ok: false; error: string }>`

- [x] **Step 1: เพิ่มสิทธิ์และป้าย audit ก่อน (ของที่เทสต์ต้องใช้)**

ใน `lib/rbac.ts` ต่อท้ายไฟล์:

```ts
/**
 * ย้าย/รวมโต๊ะ — **ทุกตำแหน่งที่เข้าจอ POS ได้ รวมพนักงานเสิร์ฟ**
 *
 * เหตุผลเดียวกับ canSetStaffMeal: คนที่เห็นลูกค้าย้ายโต๊ะจริงคือเด็กเสิร์ฟ
 * ถ้าต้องเรียกแคชเชียร์ทุกครั้ง งานจะชะงักแล้วคนจะเลี่ยงไปใช้วิธีที่แย่กว่า
 * (สั่งของโต๊ะใหม่ใส่บิลเก่า) ซึ่งมองไม่เห็นในระบบเลย
 *
 * ตัวคุมไม่ใช่การจำกัดสิทธิ์ แต่คือ AuditLog ที่เก็บ **ยอดเงินที่ถูกย้าย**
 * บวกกับด่าน "ห้ามแตะรอบที่จ่ายเงินแล้ว" ใน lib/server/table-move.ts
 */
export function canMoveTableSession(role: StaffRole): boolean {
  return canAccessScreen(role, "pos");
}
```

ใน `lib/audit-log.ts` เพิ่มสองบรรทัดในตารางป้าย action (คีย์ตรงกับที่จะเขียนจริง):

```ts
  "table_session.move": "ย้ายโต๊ะ",
  "table_session.merge": "รวมโต๊ะ",
```

- [x] **Step 2: เขียน smoke suite ที่ยังไม่ผ่าน**

สร้าง `scripts/smoke-table-move.ts` — โครงตามชุดอื่น (`check()` + สรุปท้าย + cleanup)
ชุดนี้ **สร้างโต๊ะของตัวเองสองตัวแล้วลบทิ้ง** เพื่อไม่ชนกับ smoke ชุดอื่น:

```ts
import "dotenv/config";

import { prisma } from "@/lib/server/db";
import { getSessionBill } from "@/lib/server/billing";
import { moveTableSession } from "@/lib/server/table-move";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) passed += 1;
  else failed += 1;
}

const SRC_NAME = "MV-SRC";
const DST_NAME = "MV-DST";

/** ลบตามลำดับที่ FK บังคับ: ออร์เดอร์ → ใบเสร็จ → การรับเงิน → รอบโต๊ะ → โต๊ะ */
async function cleanup(branchId: string) {
  const tables = await prisma.restaurantTable.findMany({
    where: { branchId, name: { in: [SRC_NAME, DST_NAME] } },
    select: { id: true },
  });
  const tableIds = tables.map((t) => t.id);
  if (tableIds.length === 0) return;

  const sessions = await prisma.tableSession.findMany({
    where: { tableId: { in: tableIds } },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);

  await prisma.orderItemModifier.deleteMany({
    where: { orderItem: { order: { tableSessionId: { in: sessionIds } } } },
  });
  await prisma.orderItem.deleteMany({ where: { order: { tableSessionId: { in: sessionIds } } } });
  await prisma.order.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.receipt.deleteMany({ where: { payment: { tableSessionId: { in: sessionIds } } } });
  await prisma.payment.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.restaurantTable.deleteMany({ where: { id: { in: tableIds } } });
}
```

เคสของ Task นี้ (เขียนต่อใน `main()` — ดู Step 3 สำหรับตัวช่วยสร้างข้อมูล):

```ts
  // ── ย้ายรอบที่มีของอยู่ไปโต๊ะว่าง ────────────────────────────────────
  const before = await getSessionBill(branchId, session.id);
  const moved = await moveTableSession(staff, { sessionId: session.id, targetTableId: dst.id });

  check("ย้ายสำเร็จ", moved.ok === true);
  check("ย้ายออร์เดอร์ครบทุกใบ", moved.ok === true && moved.movedOrders === 2, `${moved.ok ? moved.movedOrders : "-"} ใบ`);

  const after = await getSessionBill(branchId, session.id);
  check(
    "ยอดบิลเท่าเดิมเป๊ะหลังย้าย",
    before!.bill.grandTotal === after!.bill.grandTotal,
    `${before!.bill.grandTotal} → ${after!.bill.grandTotal}`,
  );

  const orphan = await prisma.order.count({ where: { tableSessionId: session.id, tableId: src.id } });
  check("ไม่มีออร์เดอร์ที่ยังชี้โต๊ะเดิมค้างอยู่", orphan === 0, `${orphan} ใบ`);

  const draftMoved = await prisma.order.count({
    where: { tableSessionId: session.id, status: "DRAFT", tableId: dst.id },
  });
  check("ตะกร้า DRAFT ย้ายตามไปด้วย", draftMoved === 1);

  const tables = await prisma.restaurantTable.findMany({
    where: { id: { in: [src.id, dst.id] } },
    select: { id: true, status: true },
  });
  check("โต๊ะต้นทางกลับเป็นว่าง", tables.find((t) => t.id === src.id)?.status === "AVAILABLE");
  check("โต๊ะปลายทางเป็นไม่ว่าง", tables.find((t) => t.id === dst.id)?.status === "OCCUPIED");

  const log = await prisma.auditLog.findFirst({
    where: { entityId: session.id, action: "table_session.move" },
    orderBy: { createdAt: "desc" },
  });
  const meta = (log?.metadata ?? {}) as Record<string, unknown>;
  check("เขียน AuditLog พร้อมยอดเงินที่ย้าย", meta.movedAmount === before!.bill.grandTotal);
```

- [x] **Step 3: เพิ่มตัวช่วยสร้างข้อมูลใน smoke (ยังอยู่ในไฟล์เดียวกัน)**

```ts
/** สร้างโต๊ะทดสอบสองตัว + รอบขายที่มีของจริงในนั้น */
async function seedScenario() {
  const branch = await prisma.branch.findFirstOrThrow({ where: { isActive: true } });
  const staffRow = await prisma.staff.findFirstOrThrow({
    where: { branchId: branch.id, role: "MANAGER", isActive: true },
  });
  const staff = { id: staffRow.id, branchId: branch.id, role: staffRow.role, name: staffRow.name };

  await cleanup(branch.id);

  const src = await prisma.restaurantTable.create({
    data: { branchId: branch.id, name: SRC_NAME, tableCode: `mv-src-${Date.now()}`, seats: 4, kind: "DINE_IN" },
  });
  const dst = await prisma.restaurantTable.create({
    data: { branchId: branch.id, name: DST_NAME, tableCode: `mv-dst-${Date.now()}`, seats: 4, kind: "DINE_IN" },
  });

  return { branch, staff, src, dst };
}
```

เปิดรอบและใส่ของด้วยฟังก์ชันจริงของระบบ (`openTableByStaff` → `addToCart` → `placeOrder`
แล้ว `addToCart` อีกครั้งเพื่อให้เหลือตะกร้า `DRAFT` ค้างไว้หนึ่งใบ) — **ห้ามสร้าง
`Order` ด้วย `prisma.order.create()` ตรง ๆ** เพราะจะได้ข้อมูลที่ไม่เหมือนของจริง
แล้วเทสต์จะเขียวทั้งที่เส้นทางจริงพัง

- [x] **Step 4: รันเทสต์ให้เห็นว่าพัง**

เพิ่มใน `package.json`:

```json
    "smoke:table-move": "tsx --conditions=react-server scripts/smoke-table-move.ts"
```

Run: `npm run smoke:table-move`
Expected: **FAIL** ด้วย `Cannot find module '@/lib/server/table-move'`

- [x] **Step 5: เขียน `lib/server/table-move.ts` ให้ผ่าน**

```ts
import "server-only";

import { canMoveTableSession } from "@/lib/rbac";
import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * ย้ายโต๊ะ / รวมโต๊ะ (งานค้างจากบทที่ 9)
 *
 * เป็น leaf module: ไม่มีไฟล์ไหนใน lib/server/ import กลับมาที่นี่ (ท่าเดียวกับ
 * receipt-issue.ts ของบทที่ 12) — pos.ts อยู่ที่ 541 บรรทัดแล้ว การยัดเพิ่มทำให้
 * ไฟล์ที่ทำหลายเรื่องอยู่แล้วโตขึ้นอีก
 *
 * **สองฟังก์ชันแยกกัน ไม่ใช่ตัวเดียวที่เดาเองว่าย้ายหรือรวม** — คนที่ตั้งใจ "ย้าย"
 * แล้วเผลอเลือกโต๊ะที่มีคนนั่ง จะได้ผลลัพธ์เป็นการรวมบิลของคนอื่นเข้าด้วยกัน
 * ซึ่งเป็นความเสียหายเรื่องเงินที่กู้คืนอัตโนมัติไม่ได้
 */

/** ออร์เดอร์ที่ต้องย้ายตามไปด้วย — รวม DRAFT เพราะไม่ย้าย = ของหายพร้อมโต๊ะ */
const MOVABLE_ORDER_STATUSES = ["DRAFT", "PLACED", "IN_PROGRESS", "READY", "SERVED"] as const;

export async function moveTableSession(
  staff: CurrentStaff,
  input: { sessionId: string; targetTableId: string },
) {
  if (!canMoveTableSession(staff.role)) {
    return { ok: false as const, error: "ตำแหน่งของคุณย้ายโต๊ะไม่ได้" };
  }

  const result = await prisma.$transaction(async (tx) => {
    // อ่านสดในทรานแซกชัน — ค่าที่หน้าจอส่งมาบอกได้แค่ "ผู้ใช้ตั้งใจอะไร" ไม่ใช่ "ตอนนี้จริงไหม"
    const session = await tx.tableSession.findFirst({
      where: { id: input.sessionId, branchId: staff.branchId, status: "OPEN" },
      include: { table: true, payments: { select: { id: true }, take: 1 } },
    });

    if (!session) return { ok: false as const, error: "ไม่พบรอบโต๊ะที่เปิดอยู่" };
    if (session.payments.length > 0) {
      return { ok: false as const, error: "บิลนี้รับเงินไปแล้ว ย้ายไม่ได้" };
    }
    if (session.staffCustomerId) {
      return {
        ok: false as const,
        error: "บิลนี้ติดธงส่วนลดพนักงานอยู่ ให้ปลดธงก่อนแล้วค่อยย้าย",
      };
    }
    if (session.table.kind !== "DINE_IN") {
      return { ok: false as const, error: "ย้ายได้เฉพาะโต๊ะนั่งเท่านั้น" };
    }

    const target = await tx.restaurantTable.findFirst({
      where: { id: input.targetTableId, branchId: staff.branchId, isActive: true },
    });

    if (!target) return { ok: false as const, error: "ไม่พบโต๊ะปลายทาง" };
    if (target.kind !== "DINE_IN") {
      return { ok: false as const, error: "ย้ายไปจุดขายที่ไม่ใช่โต๊ะนั่งไม่ได้" };
    }
    if (target.id === session.tableId) {
      return { ok: false as const, error: "โต๊ะปลายทางเป็นโต๊ะเดิม" };
    }

    const occupied = await tx.tableSession.count({
      where: { tableId: target.id, status: "OPEN" },
    });

    if (occupied > 0) {
      return {
        ok: false as const,
        error: `โต๊ะ ${target.name} มีบิลที่เปิดอยู่แล้ว ถ้าต้องการรวมบิลให้กด "รวมโต๊ะ"`,
      };
    }

    const orders = await tx.order.findMany({
      where: { tableSessionId: session.id, status: { in: [...MOVABLE_ORDER_STATUSES] } },
      select: { id: true, grandTotal: true, subtotal: true },
    });

    await tx.order.updateMany({
      where: { id: { in: orders.map((order) => order.id) } },
      data: { tableId: target.id },
    });

    await tx.tableSession.update({
      where: { id: session.id },
      data: { tableId: target.id },
    });

    await tx.restaurantTable.update({ where: { id: session.tableId }, data: { status: "AVAILABLE" } });
    await tx.restaurantTable.update({ where: { id: target.id }, data: { status: "OCCUPIED" } });

    await tx.auditLog.create({
      data: {
        branchId: staff.branchId,
        staffId: staff.id,
        action: "table_session.move",
        entityType: "table_session",
        entityId: session.id,
        metadata: {
          fromTable: session.table.name,
          toTable: target.name,
          movedOrders: orders.length,
          // ยอดที่ถูกย้าย: คำถามที่ต้องตอบย้อนหลังคือ "เงินก้อนไหนขยับ" ไม่ใช่แค่ "มีการย้าย"
          movedAmount: orders.reduce((sum, order) => sum + order.subtotal, 0),
        },
      },
    });

    return { ok: true as const, movedOrders: orders.length, fromTableId: session.tableId, toTableId: target.id };
  });

  if (result.ok) {
    // หลัง commit เท่านั้น (กฎบทที่ 8) และยิงสองโต๊ะเพราะจอที่เปิดค้างอยู่มีทั้งสองฝั่ง
    await announce(staff.branchId, result.fromTableId);
    await announce(staff.branchId, result.toTableId);
  }

  return result;
}

async function announce(branchId: string, tableId: string) {
  await publishRealtimeEvent({
    v: REALTIME_EVENT_VERSION,
    type: "table_session.changed",
    branchId,
    tableId,
    at: Date.now(),
  });
}
```

**หมายเหตุเรื่อง `movedAmount`:** ใช้ผลรวม `subtotal` ของออร์เดอร์ ไม่ใช่ `grandTotal`
เพราะ `grandTotal` ของออร์เดอร์ที่ยังไม่ปิดบิลเป็น 0 (เติมตอน `takePayment()` เท่านั้น)
— ถ้าเทสต์ Step 2 เทียบกับ `bill.grandTotal` แล้วไม่ตรง ให้แก้ **เทสต์** ให้เทียบ
`bill.subtotal` ไม่ใช่แก้โค้ดให้คิดยอดเอง (การคิดยอดมีที่เดียวคือ `calculateBill()`)

- [x] **Step 6: รันเทสต์ให้ผ่าน**

Run: `npm run smoke:table-move`
Expected: PASS ทุกเคส · FAIL 0

- [x] **Step 7: Commit**

```bash
git add lib/server/table-move.ts lib/rbac.ts lib/audit-log.ts scripts/smoke-table-move.ts package.json
git commit -m "feat(pos): ย้ายโต๊ะทั้งรอบใน transaction เดียว + smoke ชุดที่ 14"
```

---

### Task 3: `mergeTableSessions()` — รวมสองโต๊ะเป็นบิลเดียว

**Files:**
- Modify: `lib/server/table-move.ts` · `scripts/smoke-table-move.ts`

**Interfaces:**
- Consumes: `canMoveTableSession()` · `MOVABLE_ORDER_STATUSES` จาก Task 2
- Produces: `mergeTableSessions(staff: CurrentStaff, input: { sourceSessionId: string; targetSessionId: string }): Promise<{ ok: true; movedOrders: number } | { ok: false; error: string }>`

- [x] **Step 1: เขียนเคสที่ยังไม่ผ่าน**

ต่อใน `scripts/smoke-table-move.ts`:

```ts
  // ── รวมสองโต๊ะ ────────────────────────────────────────────────────────
  const srcBill = await getSessionBill(branchId, srcSession.id);
  const dstBill = await getSessionBill(branchId, dstSession.id);

  const merged = await mergeTableSessions(staff, {
    sourceSessionId: srcSession.id,
    targetSessionId: dstSession.id,
  });
  check("รวมสำเร็จ", merged.ok === true);

  const after = await getSessionBill(branchId, dstSession.id);
  check(
    "ค่าอาหารของบิลรวม = ผลบวกของสองบิลเดิม",
    after!.bill.subtotal === srcBill!.bill.subtotal + dstBill!.bill.subtotal,
    `${srcBill!.bill.subtotal} + ${dstBill!.bill.subtotal} = ${after!.bill.subtotal}`,
  );

  // เซอร์วิสชาร์จ/VAT ต้องถูกคิด **ครั้งเดียวบนยอดรวม** ไม่ใช่บวกยอดที่คิดแยกกันมาแล้ว
  // (กฎบทที่ 10 — คิดทีละใบแล้วบวกจะปัดเศษหลายรอบ)
  check(
    "VAT คิดครั้งเดียวบนยอดรวม",
    after!.bill.vatAmount !== srcBill!.bill.vatAmount + dstBill!.bill.vatAmount ||
      after!.bill.netAmount + after!.bill.vatAmount === after!.bill.grandTotal,
  );
  check("ยอดรวมเป็นจำนวนเต็มและประกอบกันลงตัว",
    Number.isInteger(after!.bill.grandTotal) &&
      after!.bill.netAmount + after!.bill.vatAmount === after!.bill.grandTotal);

  const src = await prisma.tableSession.findUniqueOrThrow({ where: { id: srcSession.id } });
  check("รอบต้นทางเป็น MERGED", src.status === "MERGED");
  check("รอบต้นทางชี้ไปรอบปลายทาง", src.mergedIntoSessionId === dstSession.id);
  check("รอบต้นทางไม่มีออร์เดอร์เหลือ",
    (await prisma.order.count({ where: { tableSessionId: srcSession.id } })) === 0);
  check("pax บวกกัน", (await prisma.tableSession.findUniqueOrThrow({ where: { id: dstSession.id } })).pax === 6);
```

เคสปฏิเสธที่ต้องมีด้วย (เขียนเป็น `check` ทีละอัน):

```ts
  const sameSession = await mergeTableSessions(staff, {
    sourceSessionId: dstSession.id,
    targetSessionId: dstSession.id,
  });
  check("รวมโต๊ะเข้ากับตัวเอง = error", sameSession.ok === false);

  const counter = await prisma.restaurantTable.findFirstOrThrow({
    where: { branchId, kind: "TAKEAWAY_COUNTER" },
  });
  // เปิดรอบที่เคาน์เตอร์แล้วลองรวมกับโต๊ะนั่ง — ต้องถูกปฏิเสธ เพราะซื้อกลับไม่คิด
  // เซอร์วิสชาร์จ ถ้ารวมได้ยอดจะเปลี่ยนเงียบ ๆ
  check("รวมข้ามช่องทาง = error", crossChannel.ok === false);

  check("รวมรอบที่ติดธงส่วนลดพนักงาน = error", flagged.ok === false);
  check("รวมรอบที่จ่ายเงินแล้ว = error", paid.ok === false);
  check("รวมข้ามสาขา = error", crossBranch.ok === false);
```

และเคสปิดท้ายที่พิสูจน์ข้ออ้างหลักของแผนนี้:

```ts
  // รับเงินบิลรวมจนจบ = พิสูจน์ว่า takePayment/ใบเสร็จไม่ต้องแก้จริงอย่างที่อ้าง
  const payment = await takePayment(staff, { tableId: dstTable.id, sessionId: dstSession.id, method: "CASH", expectedTotal: after!.bill.grandTotal });
  check("รวมแล้วรับเงินได้จนจบ", payment.ok === true);
  check("ออกใบเสร็จให้บิลรวมแล้ว",
    (await prisma.receipt.count({ where: { paymentId: payment.ok ? payment.paymentId : "" } })) === 1);
```

> ลายเซ็นจริงของ `takePayment()` อยู่ใน `lib/server/payment.ts` — เปิดอ่านแล้วส่ง
> อาร์กิวเมนต์ให้ตรง อย่าเดา

- [x] **Step 2: รันให้เห็นว่าพัง**

Run: `npm run smoke:table-move`
Expected: FAIL — `mergeTableSessions is not exported`

- [x] **Step 3: เขียน `mergeTableSessions()`**

โครงเดียวกับ `moveTableSession()` ต่างที่:

```ts
export async function mergeTableSessions(
  staff: CurrentStaff,
  input: { sourceSessionId: string; targetSessionId: string },
) {
  if (!canMoveTableSession(staff.role)) {
    return { ok: false as const, error: "ตำแหน่งของคุณรวมโต๊ะไม่ได้" };
  }

  if (input.sourceSessionId === input.targetSessionId) {
    return { ok: false as const, error: "เลือกโต๊ะปลายทางที่ไม่ใช่โต๊ะเดิม" };
  }

  const result = await prisma.$transaction(async (tx) => {
    // อ่านทั้งสองรอบด้วยเงื่อนไขชุดเดียวกัน — เขียนเป็นตัวช่วยในไฟล์นี้
    // (loadOpenSessionForMove) แล้วเรียกสองครั้ง ห้ามก๊อปเงื่อนไขไปสองที่
    // เพราะที่ที่ลืมข้อหนึ่งคือประตูหลังที่เปิดค้าง (บทเรียนจาก loadActiveStaffSession)
    const source = await loadOpenSessionForMove(tx, staff.branchId, input.sourceSessionId);
    if (!source.ok) return source;

    const target = await loadOpenSessionForMove(tx, staff.branchId, input.targetSessionId);
    if (!target.ok) return target;

    // ── ย้ายออร์เดอร์ทั้งชุด (เหมือน move) ──
    // ── ปิดรอบต้นทาง ──
    await tx.tableSession.update({
      where: { id: source.session.id },
      data: {
        status: "MERGED",
        mergedIntoSessionId: target.session.id,
        closedAt: new Date(),
      },
    });

    // pax บวกกัน: บิลรวมคือคนสองกลุ่มนั่งด้วยกัน รายงานยอดต่อหัวบทที่ 15 ต้องได้ตัวหารที่ถูก
    await tx.tableSession.update({
      where: { id: target.session.id },
      data: { pax: source.session.pax + target.session.pax },
    });

    // โต๊ะต้นทางว่าง · โต๊ะปลายทางไม่ว่าง · AuditLog "table_session.merge"
    // metadata เพิ่ม targetAmountBefore เพื่อให้ตอบได้ว่าเงินก้อนไหนรวมกับก้อนไหน
  });

  // announce ทั้งสองโต๊ะหลัง commit
}
```

`loadOpenSessionForMove()` รวมด่านทั้งหมดไว้ที่เดียว: อยู่สาขาเดียวกัน · `status OPEN`
· ไม่มี `Payment` · `staffCustomerId` เป็น null · `table.kind === "DINE_IN"`

- [x] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm run smoke:table-move`
Expected: PASS ทุกเคส · FAIL 0

- [x] **Step 5: Commit**

```bash
git add lib/server/table-move.ts scripts/smoke-table-move.ts
git commit -m "feat(pos): รวมสองโต๊ะเป็นบิลเดียว (กลืนรอบต้นทางเป็น MERGED)"
```

---

### Task 4: มือถือลูกค้าเดินตามโซ่ merge

**Files:**
- Modify: `lib/server/table-session.ts:53-90` (`resolveCustomerContext`)
- Modify: `app/(customer)/t/[tableCode]/page.tsx`
- Modify: `scripts/smoke-table-move.ts`

**Interfaces:**
- Consumes: `TableSession.mergedIntoSessionId` จาก Task 1
- Produces: `resolveCustomerContext()` คืน `{ table, branch, session, mergedFromTableName }`
  โดย `mergedFromTableName` เป็น `string | null` — ชื่อโต๊ะเดิมที่ลูกค้ากำลังนั่งอยู่
  เมื่อรอบถูกย้าย/รวมไปโต๊ะอื่นแล้ว

- [x] **Step 1: เขียนเคสที่ยังไม่ผ่าน**

```ts
  // cookie ของรอบที่ถูกกลืน ต้องพาไปโผล่ที่รอบปลายทาง ไม่ใช่กลายเป็น "ไม่มีรอบ"
  // (ถ้าเป็น "ไม่มีรอบ" ลูกค้าจะกดเปิดโต๊ะใหม่ = บิลผีที่พนักงานไม่รู้ตัว)
  const followed = await resolveSessionByToken(branchId, srcSession.token);
  check("cookie ของรอบที่ถูกกลืนเดินตามโซ่ไปรอบปลายทาง", followed?.id === dstSession.id);

  check("โซ่ลึกสองชั้นก็ยังเดินถึงปลายทาง", twoHop?.id === finalSession.id);
  check("รอบปลายทางที่ปิดไปแล้ว = ไม่มีรอบ (ไม่ใช่พาไปบิลที่ปิด)", afterPaid === null);
```

> `resolveSessionByToken()` เป็นฟังก์ชันใหม่ที่ export จาก `lib/server/table-session.ts`
> แยกออกมาจาก `resolveCustomerContext()` เพราะตัวหลังเรียก `cookies()` ของ next/headers
> ซึ่งเรียกนอก request ของ Next ไม่ได้ — ท่าเดียวกับที่บทที่ 13b แยก
> `staff-session-store.ts` ออกจาก `staff-session.ts` เพื่อให้ smoke เรียกได้ตรง ๆ

- [x] **Step 2: รันให้เห็นว่าพัง**

Run: `npm run smoke:table-move`
Expected: FAIL — `resolveSessionByToken is not a function`

- [x] **Step 3: เขียนตัวเดินโซ่**

ใน `lib/server/table-session.ts`:

```ts
/** ลึกสุดที่ยอมเดินตามโซ่ — กันโซ่วนถ้าข้อมูลเพี้ยน (A→B→A) ไม่ให้ค้างทั้ง request */
const MAX_MERGE_HOPS = 5;

/**
 * หารอบขายจาก token ของลูกค้า **แล้วเดินตามโซ่ merge ไปจนถึงรอบที่ยังเปิดอยู่**
 *
 * เดิมฟังก์ชันนี้ผูก `tableId` ไว้ด้วย ซึ่งถูกต้องตอนที่รอบขายย้ายโต๊ะไม่ได้
 * พอย้าย/รวมโต๊ะได้แล้ว การผูก tableId แปลว่าลูกค้าที่ยังนั่งอยู่โต๊ะเดิมจะได้
 * "ไม่มีรอบ" แล้วถ้ากดเปิดโต๊ะใหม่จะเกิดบิลใบที่สองที่พนักงานไม่รู้ตัว
 */
export async function resolveSessionByToken(branchId: string, token: string) {
  let current = await prisma.tableSession.findFirst({ where: { token, branchId } });

  for (let hop = 0; current && hop < MAX_MERGE_HOPS; hop += 1) {
    if (current.status === "OPEN") {
      return current.expiresAt > new Date() ? current : null;
    }

    if (current.status !== "MERGED" || !current.mergedIntoSessionId) {
      return null;
    }

    current = await prisma.tableSession.findUnique({ where: { id: current.mergedIntoSessionId } });
  }

  return null;
}
```

แล้วให้ `resolveCustomerContext()` เรียกตัวนี้แทน query เดิม และคืน
`mergedFromTableName` = ชื่อโต๊ะของ `table` ตัวปัจจุบัน เมื่อ `session.tableId !== table.id`

- [x] **Step 4: บอกลูกค้าบนหน้าจอ**

ใน `app/(customer)/t/[tableCode]/page.tsx` เหนือรายการเมนู เมื่อ `mergedFromTableName`
ไม่เป็น null:

```tsx
<p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
  โต๊ะนี้ถูกรวมกับ <strong>{context.session.table.name}</strong> แล้ว
  รายการที่สั่งต่อจากนี้จะเข้าบิลเดียวกัน
</p>
```

**ห้ามเปลี่ยนชื่อโต๊ะเงียบ ๆ** — คนที่นั่งอยู่ต้องเข้าใจว่าทำไมมือถือขึ้นอีกโต๊ะ
(หน้าลูกค้าไม่มี `pos-skin` ใช้ utility ล้วนตามลุคเดิมของหน้านี้)

- [x] **Step 5: รันเทสต์ + ชุดลูกค้าเดิม**

```bash
npm run smoke:table-move && npm run smoke:order
```
Expected: ทั้งสองชุด FAIL 0

- [x] **Step 6: Commit**

```bash
git add lib/server/table-session.ts "app/(customer)/t/[tableCode]/page.tsx" scripts/smoke-table-move.ts
git commit -m "feat(customer): มือถือเดินตามโซ่รวมโต๊ะไปบิลปลายทาง"
```

---

### Task 5: ปุ่มและฟอร์มบนหน้าโต๊ะ

**Files:**
- Modify: `lib/server/pos.ts` (เพิ่ม `getMoveTargets`)
- Modify: `app/(pos)/pos/actions.ts`
- Modify: `app/(pos)/pos/_components/table-actions.tsx`
- Modify: `app/(pos)/pos/_components/sale-point-screen.tsx`

**Interfaces:**
- Consumes: `moveTableSession()` · `mergeTableSessions()` · `canMoveTableSession()`
- Produces:
  - `getMoveTargets(branchId, currentTableId): Promise<{ free: {id,name}[]; occupied: {id,name,sessionId,total}[] }>`
  - `moveTableAction(prev: FormState, formData: FormData): Promise<FormState>`
  - `mergeTableAction(prev: FormState, formData: FormData): Promise<FormState>`

- [x] **Step 1: `getMoveTargets()` ใน `lib/server/pos.ts`**

คืนโต๊ะนั่งที่ `isActive` ในสาขาเดียวกัน ยกเว้นโต๊ะปัจจุบัน แบ่งสองกลุ่มตามว่ามีรอบ
`status: "OPEN"` อยู่ไหม · กลุ่มที่มีคนต้องแนบ **ยอดปัจจุบัน** ที่ได้จาก `getSessionBill()`
เพราะคนกดต้องเห็นว่ากำลังจะรวมเงินก้อนไหนเข้ากับก้อนไหน

- [x] **Step 2: สอง action ใน `app/(pos)/pos/actions.ts`**

รูปแบบเดียวกับ `setStaffMealAction` เป๊ะ ๆ:

```ts
export async function moveTableAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();
  if (!staff) return NOT_SIGNED_IN;

  const result = await moveTableSession(staff, {
    sessionId: String(formData.get("sessionId") ?? ""),
    targetTableId: String(formData.get("targetTableId") ?? ""),
  });

  if (!result.ok) return { status: "error", message: result.error };

  // ย้ายแล้ว URL เดิม (/pos/table/<โต๊ะเก่า>) ชี้โต๊ะที่ว่างแล้ว ต้องพาไปโต๊ะใหม่
  redirect(`/pos/table/${String(formData.get("targetTableId"))}`);
}
```

`mergeTableAction` ทำแบบเดียวกันแต่ redirect ไปโต๊ะปลายทางของรอบที่รวมแล้ว
**ห้ามรับ `base` จากฟอร์ม** — คำนวณเส้นทางจาก `kind` เหมือนที่ `salePointBasePath()` ทำ

- [x] **Step 3: ฟอร์มใน `table-actions.tsx`**

`<form>` จริงตามแบบไฟล์นี้ (`useActionState` + ปุ่มที่ disable ตัวเองด้วย `useFormStatus`)
· กลุ่ม "โต๊ะว่าง" ปุ่มเขียนว่า **ย้ายมาที่นี่** · กลุ่ม "โต๊ะที่มีคน" ปุ่มเขียนว่า
**รวมบิลเข้าด้วยกัน** พร้อมยอดของโต๊ะนั้นด้วย `formatMoney(total, currency)`
· ปุ่มรวมต้องมีขั้นยืนยันที่บอกยอดรวมใหม่ ไม่ใช่กดทีเดียวจบ

- [x] **Step 4: วางในจอ**

ใน `sale-point-screen.tsx` วางแผงนี้ **ในโซนที่เลื่อนได้** (ใต้รายการบิลที่ส่งแล้ว
ที่เดียวกับที่ `CustomerNameForm` อยู่) **ห้ามวางในโซน `flex-none`**
· แสดงเฉพาะจุดขายที่ `kind === "DINE_IN"` และเฉพาะเมื่อ `canMoveTableSession(role)`

- [x] **Step 5: ตรวจด้วยเซิร์ฟเวอร์จริง**

```bash
npm run build && npm run start -- -p 3002
```
แล้วยิงด้วย cookie จาก `npm run dev:staff-cookie 002 pos` — ยืนยันว่า HTML ที่ออกมา
มีปุ่มทั้งสองกลุ่มจริง และกดย้ายแล้วถูก redirect ไปโต๊ะใหม่
**อ่าน HTML ที่เซิร์ฟเวอร์ส่งออกมาจริง ไม่ใช่เชื่อว่าโค้ดถูก** (บทเรียนจากก้อน KDS
ที่จอหลุดสามจุดทั้งที่เทสต์เขียว)

- [x] **Step 6: Commit**

```bash
git add lib/server/pos.ts "app/(pos)/pos/actions.ts" "app/(pos)/pos/_components/table-actions.tsx" "app/(pos)/pos/_components/sale-point-screen.tsx"
git commit -m "feat(pos): ปุ่มย้าย/รวมโต๊ะบนหน้าโต๊ะ"
```

---

### Task 6: ตรวจครบชุด + เอกสาร

**Files:**
- Modify: `CLAUDE.md`
- Create: `report/2026-08-25-table-move-merge.md`

- [x] **Step 1: ตรวจครบ**

```bash
npx tsc --noEmit && npx eslint && npm run build
for s in order pos kds bill payment menu receipt staff-meal takeaway staff-session staff-admin settings dashboard table-move; do
  out=$(npm run --silent smoke:$s 2>&1) || echo "FAILED: $s"
  echo "$s: $(echo "$out" | grep -c '^PASS') PASS / $(echo "$out" | grep -c '^FAIL') FAIL"
done
```
Expected: 14 ชุด · FAIL 0 ทุกชุด (ของเดิม 705 เคส + ชุดใหม่)

- [x] **Step 2: วัดจอ**

```bash
npm run audit:screens
```
ต้องครอบหน้า `/pos/table/[tableId]` **ตอนที่กางฟอร์มเลือกโต๊ะแล้ว** ไม่ใช่ตอนพับอยู่
· ต้องมีข้อมูลจริงบนโต๊ะก่อนวัด ไม่งั้นจะได้ FAIL ที่ไม่ใช่บั๊กจอ

- [x] **Step 3: เขียนรายงาน**

`report/2026-08-25-table-move-merge.md` — รูปแบบเดียวกับรายงานก้อนก่อน: อะไรเปลี่ยน ·
กับดักที่เจอจริง · ตัวเลขที่ยืนยันด้วยของจริง (ยอดก่อน/หลังรวม) · สิ่งที่ยังไม่ได้ทำ

- [x] **Step 4: อัปเดต `CLAUDE.md`**

เพิ่มหัวข้อสถานะของก้อนนี้ · ตัด "ย้าย/รวมโต๊ะ + แยกบิล ยังไม่ได้ทำ" ออกจากรายการงานค้าง
แล้วเหลือเฉพาะ **แยกบิล** · บันทึกกฎใหม่: *ค่า `MERGED` มีอยู่แล้ว query ที่ถามสถานะรอบ
ต้องคิดถึงมันเสมอ* และ *`lib/server/table-move.ts` เป็น leaf module ห้าม import กลับ*

- [x] **Step 5: Commit**

```bash
git add CLAUDE.md report/2026-08-25-table-move-merge.md
git commit -m "docs: บันทึกก้อนย้าย/รวมโต๊ะ"
```

---

## Self-Review (ทำแล้วตอนเขียนแผน)

**Spec coverage** — ทุกหัวข้อของ spec มี Task รองรับ: §2 รูปร่างข้อมูล → Task 1 ·
§3 โมดูล+ด่าน → Task 2-3 · §4 ลูกค้าเดินตามโซ่ → Task 4 · §5 สิทธิ์ → Task 2 Step 1 ·
§6 หน้าจอ → Task 5 · §7 เทสต์ → กระจายอยู่ใน Task 2-4 และรวบใน Task 6 ·
§8 สิ่งที่ไม่ทำ → ไม่มี Task โดยตั้งใจ

**สิ่งที่แผนนี้แก้จาก spec:** `onDelete` ของ `mergedIntoSessionId` เป็น `SetNull`
ไม่ใช่ `Restrict` (เหตุผลอยู่ใน Global Constraints)

**จุดที่รู้ตัวว่ายังต้องอ่านโค้ดจริงตอนลงมือ:** ลายเซ็นของ `takePayment()` ใน Task 3
Step 1 และรูปร่างที่ `getSessionBill()` คืน — แผนเขียนไว้ว่าให้เปิดอ่าน ไม่ให้เดา
