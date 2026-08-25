# บทที่ 15 — กะ / ปิดกะ / ใบสรุปกะ — Implementation Plan

> **สำหรับคนที่ลงมือ (คนหรือ agent):** ทำทีละ Task ตามลำดับ ทุก Task จบด้วย commit
> และของที่ทดสอบได้เอง · ช่องติ๊ก `- [ ]` ใช้ติดตามความคืบหน้า
>
> **REQUIRED SUB-SKILL:** ใช้ `superpowers:subagent-driven-development` (แนะนำ) หรือ
> `superpowers:executing-plans` เพื่อลงมือทีละ Task

**Goal:** ตอบให้ได้ว่า "เงินสดในลิ้นชักตอนนี้ควรมีเท่าไร นับได้จริงเท่าไร ต่างกันเท่าไร
และส่วนต่างเกิดในกะของใคร"

**Architecture:** `Payment` ทุกใบผูกกับกะที่เปิดอยู่ ณ วินาทีที่รับเงิน (`Payment.shiftId`)
X report รวมยอดสดจากแถวเหล่านั้น · ปิดกะคือการ snapshot ยอดลงแถว `Shift` ในทรานแซกชัน
เดียวกับการเปลี่ยนสถานะ · ชั้นคิดเงิน/ใบเสร็จ/KDS ไม่ถูกแตะเลย มีแค่ `takePayment()`
ที่เพิ่มคอลัมน์เดียว

**Tech Stack:** Next.js 16.2 (App Router) · Prisma 7 (`prisma-client` generator +
`@prisma/adapter-pg`) · PostgreSQL 17 ใน Docker · smoke test เป็นสคริปต์ `tsx --conditions=react-server`

**Spec:** `report/2026-08-25-plan-chapter-15-shift.md` — อ่านคู่กันเสมอ แผนนี้เถียงจาก spec นั้น

## Global Constraints

- เงินเป็น `Int` หน่วยย่อยของสกุลเงินสาขา · **ห้ามหาร 100 นอก `lib/money.ts`** · ห้าม float
- **ห้ามเขียน "฿" ลงหน้าจอ** ใช้ `formatMoney(amount, currency)` โดย currency มาจาก `branch.currency`
- ทุก query กรอง `staff.branchId` เสมอ
- ไฟล์ใน `lib/server/` ขึ้นต้นด้วย `import "server-only"`
- ไฟล์ `"use server"` export ได้เฉพาะ async function
- `publishRealtimeEvent()` เรียก **หลัง** commit ห้ามเรียกใน `$transaction`
- แก้หลายตารางพร้อมกัน = `$transaction` เดียว
- import Prisma client จาก `@/lib/generated/prisma/client` ไม่ใช่ `@prisma/client`
- **รัน `prisma generate`/`migrate` ขณะ `npm run dev` เปิดอยู่ = ต้องรีสตาร์ท dev server**
- หน้าใหม่ใน `(pos)`/`(admin)` ต้องใส่ `min-h-0` + `overflow-auto` เอง · ของที่เพิ่มในโซน
  `flex-none` จะไปกินพื้นที่โซนที่เลื่อนได้เสมอ
- ป้ายบนหน้าจอเป็นภาษาไทยทั้งหมด

**การแก้ spec หนึ่งข้อระหว่างเขียนแผน:** spec §6 วางหน้าประวัติกะไว้ที่ `/admin/shifts`
ซึ่งยังอยู่ **แต่ไม่เพิ่มเข้าแถบเมนูของจอหลังร้าน** เพราะแถบล่างของจอแคบมีหกโมดูลแล้ว
(CLAUDE.md เขียนเตือนไว้ว่า "เพิ่มโมดูลที่เจ็ดต้องคิดใหม่" — ที่ 390px เหลือช่องละ ~55px)
ทางเข้าคือ **ลิงก์จากหน้า "สรุปวันนี้"** ซึ่งคนที่เห็นเป็นชุดเดียวกับ `canViewShiftHistory`
(OWNER/MANAGER) พอดี และเป็นหน้าที่ผู้จัดการเปิดอยู่แล้วทุกเช้า

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `lib/server/shift-current.ts` | **leaf** — `resolveOpenShiftId(tx, branchId)` ตัวเดียว | 1 |
| `lib/server/payment.ts` | เพิ่ม `shiftId` ตอนสร้าง `Payment` (แก้ ~3 บรรทัด) | 1 |
| `prisma/migrations/*_one_open_shift_per_branch/` | partial unique index กันสองกะเปิดพร้อมกัน | 2 |
| `lib/rbac.ts` | `canManageShift` · `canViewShiftHistory` | 2 |
| `lib/audit-log.ts` | ป้ายไทยของ `shift.open` / `shift.close` | 2 |
| `lib/realtime-events.ts` | เพิ่ม `"shift.changed"` | 2 |
| `lib/server/shift.ts` | `openShift` · `getOpenShift` · `getShiftReport` · `closeShift` · `getShift` · `listShifts` | 2-4, 6 |
| `components/shift-summary.tsx` | ใบสรุปกะ ใช้ร่วมกันทั้งจอ POS และหลังร้าน | 5 |
| `app/(pos)/pos/shift/page.tsx` | จอเดียวสองโหมด (เปิดกะ / X + ปิดกะ) | 5 |
| `app/(pos)/pos/shift/[shiftId]/page.tsx` | ใบสรุปกะ + ปุ่มพิมพ์ | 5 |
| `app/(pos)/pos/shift/_components/shift-forms.tsx` | ฟอร์มเปิด/ปิดกะ (client) | 5 |
| `app/(pos)/pos/actions.ts` | `openShiftAction` · `closeShiftAction` | 5 |
| `app/(admin)/admin/shifts/page.tsx` · `[shiftId]/page.tsx` | ประวัติกะ + ใบสรุป | 6 |
| `scripts/smoke-shift.ts` | smoke ชุดที่ 15 | 1-6 |

---

### Task 1: ผูก `Payment` เข้ากับกะ

**Files:**
- Create: `lib/server/shift-current.ts` · `scripts/smoke-shift.ts`
- Modify: `lib/server/payment.ts` · `package.json`

**Interfaces:**
- Produces: `resolveOpenShiftId(tx: Prisma.TransactionClient, branchId: string): Promise<string | null>`
- Produces: `Payment.shiftId` มีค่าจริงตั้งแต่ Task นี้เป็นต้นไป

- [ ] **Step 1: เขียนสคริปต์ smoke ที่ยังไม่ผ่าน**

สร้าง `scripts/smoke-shift.ts` — โครงเดียวกับ `scripts/smoke-table-move.ts`
(ใช้โต๊ะของตัวเองแล้วลบทิ้ง เพราะโต๊ะ seed ถูกชุดอื่นจองหมดแล้ว):

```ts
import "dotenv/config";

import { addToCart, placeOrder } from "@/lib/server/cart";
import { getSessionBill } from "@/lib/server/billing";
import { prisma } from "@/lib/server/db";
import { takePayment } from "@/lib/server/payment";
import { openTableByStaff } from "@/lib/server/pos";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * Smoke test ของกะ / ปิดกะ (บทที่ 15)
 *
 *     npm run smoke:shift
 *
 * ── สิ่งที่ชุดนี้ต้องพิสูจน์ ──────────────────────────────────────────────
 *   1. **เงินสดที่ระบบว่าควรมี ตรงกับเงินที่เข้าลิ้นชักจริง** — ใช้ grandTotal
 *      ไม่ใช่ receivedAmount (เงินทอนออกไปแล้ว) และ QR ไม่นับ
 *   2. **ไม่มีเงินก้อนไหนหายระหว่างรอยต่อของกะ** — ปิดกะพร้อมกันสองเครื่อง
 *      หรือรับเงินคาบเกี่ยวกับการปิด ต้องไม่ทำให้บิลหลุดจากทั้งสองกะ
 *   3. **ตัวเลขในใบสรุปกะที่ปิดแล้วไม่ขยับตลอดกาล** แม้แก้อัตราภาษีทีหลัง
 */

const TABLE_NAME = "SH-T1";

const KRAPAO = "seed-item-krapao";
const KRAPAO_OPTIONS = ["seed-mod-spice-mild", "seed-mod-size-regular"];

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

async function loadStaff(id: string): Promise<CurrentStaff> {
  return prisma.staff.findUniqueOrThrow({ where: { id }, include: { branch: true } });
}

/**
 * ล้างของที่ชุดนี้สร้าง — ลำดับถูกบังคับด้วย FK แบบ Restrict ทั้งสาย:
 * ออร์เดอร์ → ใบเสร็จ → การรับเงิน → รอบโต๊ะ → โต๊ะ แล้วค่อยลบกะ
 * (`Payment.shiftId` เป็น SetNull จึงลบกะทีหลังได้ แต่ต้องหลังลบ Payment เสมอ
 *  เพื่อไม่ให้เหลือแถวที่ชี้กะที่ไม่มีอยู่)
 */
async function cleanup(branchId: string) {
  const tables = await prisma.restaurantTable.findMany({
    where: { branchId, name: TABLE_NAME },
    select: { id: true },
  });
  const tableIds = tables.map((table) => table.id);

  if (tableIds.length > 0) {
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

  const shifts = await prisma.shift.findMany({ where: { branchId }, select: { id: true } });
  const shiftIds = shifts.map((shift) => shift.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: shiftIds } } });
  await prisma.shift.deleteMany({ where: { id: { in: shiftIds } } });
}

/** เปิดโต๊ะ ใส่ของ ส่งเข้าครัว แล้วรับเงิน — คืนยอดที่จ่ายจริง */
async function sellOneBill(
  staff: CurrentStaff,
  tableId: string,
  method: "CASH" | "QR",
  quantity: number,
) {
  const opened = await openTableByStaff(staff, tableId, 2);

  if (!opened.ok) {
    throw new Error(`เปิดโต๊ะไม่สำเร็จ: ${opened.error}`);
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
    // จ่ายเกินแล้วรับทอน — เงินที่เข้าลิ้นชักจริงคือ grandTotal ไม่ใช่ยอดที่ยื่นมา
    receivedAmount: method === "CASH" ? total + 10000 : null,
    expectedTotal: total,
    sessionId: session.id,
  });

  if (!paid.ok) {
    throw new Error(`รับเงินไม่สำเร็จ: ${paid.error}`);
  }

  return { paymentId: paid.paymentId, total };
}

async function main() {
  const cashier = await loadStaff("seed-staff-cashier");
  const branchId = cashier.branchId;

  await cleanup(branchId);

  const table = await prisma.restaurantTable.create({
    data: {
      branchId,
      name: TABLE_NAME,
      tableCode: `sh-t1-${Date.now()}`,
      seats: 4,
      kind: "DINE_IN",
      sortOrder: 910,
    },
  });

  console.log("── ผูกบิลเข้ากับกะ ─────────────────────────────────────────────\n");

  // ยังไม่มีกะเปิด → บิลต้องขายได้ตามปกติ และ shiftId ต้องเป็น null
  const outside = await sellOneBill(cashier, table.id, "CASH", 1);
  const outsideRow = await prisma.payment.findUniqueOrThrow({
    where: { id: outside.paymentId },
    select: { shiftId: true },
  });
  check("ไม่มีกะเปิดอยู่ก็ยังรับเงินได้ (ระบบกะไม่ใช่ด่านขวางการขาย)", outsideRow !== null);
  check("บิลที่รับนอกกะมี shiftId = null", outsideRow.shiftId === null);

  // เปิดกะด้วย prisma ตรง ๆ ใน Task นี้ (openShift() ยังไม่มี — เป็นงาน Task 2)
  const shift = await prisma.shift.create({
    data: { branchId, openedByStaffId: cashier.id, openingFloat: 100000 },
  });

  const inside = await sellOneBill(cashier, table.id, "CASH", 2);
  const insideRow = await prisma.payment.findUniqueOrThrow({
    where: { id: inside.paymentId },
    select: { shiftId: true },
  });
  check("บิลที่รับตอนมีกะเปิดอยู่ผูกกับกะนั้น", insideRow.shiftId === shift.id);

  // ปิดกะด้วย prisma ตรง ๆ แล้วขายต่อ — เงินต้องไม่ตกไปอยู่ในกะที่ปิดแล้ว
  await prisma.shift.update({
    where: { id: shift.id },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  const afterClose = await sellOneBill(cashier, table.id, "CASH", 1);
  const afterRow = await prisma.payment.findUniqueOrThrow({
    where: { id: afterClose.paymentId },
    select: { shiftId: true },
  });
  check("บิลที่รับหลังปิดกะไม่ตกไปอยู่ในกะที่ปิดแล้ว", afterRow.shiftId === null);

  console.log("\n── ล้างข้อมูลที่สร้างระหว่างทดสอบ ───────────────────────────────\n");

  await cleanup(branchId);
  check(
    "ล้างข้อมูลทดสอบหมดแล้ว",
    (await prisma.restaurantTable.count({ where: { branchId, name: TABLE_NAME } })) === 0 &&
      (await prisma.shift.count({ where: { branchId } })) === 0,
  );

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

เพิ่มใน `package.json` (ต่อจากบรรทัด `"smoke:table-move"`):

```json
    "smoke:shift": "tsx --conditions=react-server scripts/smoke-shift.ts"
```

- [ ] **Step 2: รันให้เห็นว่าพัง**

Run: `npm run smoke:shift`
Expected: FAIL ที่เคส "บิลที่รับตอนมีกะเปิดอยู่ผูกกับกะนั้น" (ได้ `null` เพราะยังไม่มีใครเขียนค่า)

- [ ] **Step 3: เขียน `lib/server/shift-current.ts`**

```ts
import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * id ของกะที่เปิดอยู่ของสาขานี้ — คืน null เมื่อไม่มีกะเปิด
 *
 * ── ทำไมเป็นไฟล์แยกที่มีฟังก์ชันเดียว ───────────────────────────────────
 * `payment.ts` ต้องเรียกตัวนี้ **ข้างใน `$transaction`** ของการรับเงิน ถ้าให้ไป
 * import `shift.ts` (ซึ่งวันหนึ่งจะ import `billing.ts` เพื่อทำรายงาน) จะเกิด
 * import cycle — ท่าเดียวกับที่บทที่ 12 แยก `receipt-issue.ts` ออกจาก `receipt.ts`
 * **ห้ามเพิ่ม import ที่ชี้กลับไปหา `payment.ts` / `shift.ts` ในไฟล์นี้**
 *
 * ── ทำไมต้องรับ `tx` ไม่ใช่ใช้ prisma ตรง ๆ ─────────────────────────────
 * เพราะคำถาม "ตอนนี้กะไหนเปิดอยู่" ต้องถูกถามในทรานแซกชันเดียวกับที่เขียนแถว
 * Payment ไม่งั้นจะมีช่องที่ปิดกะแทรกกลาง แล้วเงินก้อนนั้นถูกผูกกับกะที่ปิดไปแล้ว
 * — ใบสรุปที่พิมพ์ออกไปจะไม่มีเงินก้อนนั้น ทั้งที่แถวในฐานบอกว่าอยู่ในกะนั้น
 */
export async function resolveOpenShiftId(
  tx: Prisma.TransactionClient,
  branchId: string,
): Promise<string | null> {
  const shift = await tx.shift.findFirst({
    where: { branchId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });

  return shift?.id ?? null;
}
```

- [ ] **Step 4: ต่อเข้า `takePayment()`**

ใน `lib/server/payment.ts` เพิ่ม import:

```ts
import { resolveOpenShiftId } from "@/lib/server/shift-current";
```

แล้วในทรานแซกชัน **ก่อนบรรทัด `const payment = await tx.payment.create({`** ใส่:

```ts
    /**
     * กะที่เงินก้อนนี้ตกอยู่ (บทที่ 15) — อ่านในทรานแซกชันเสมอ ห้ามอ่านไว้ก่อน
     *
     * null ได้ตามปกติ: ร้านที่ยังไม่เปิดกะก็ต้องขายได้ ระบบกะเป็นเครื่องมือนับเงิน
     * ไม่ใช่ด่านที่ขวางการรับเงิน (เงินพวกนี้ถูกนับแยกและแสดงบนหน้าเปิดกะ)
     */
    const shiftId = await resolveOpenShiftId(tx, staff.branchId);
```

และเพิ่มบรรทัดนี้ใน `data:` ของ `tx.payment.create` ต่อจาก `paidByStaffId: staff.id,`:

```ts
        shiftId,
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

Run: `npm run smoke:shift`
Expected: PASS ทุกเคส · FAIL 0

Run: `npm run smoke:payment && npm run smoke:receipt`
Expected: FAIL 0 ทั้งสองชุด (การรับเงินเดิมต้องไม่เปลี่ยนพฤติกรรม)

- [ ] **Step 6: Commit**

```bash
git add lib/server/shift-current.ts lib/server/payment.ts scripts/smoke-shift.ts package.json
git commit -m "feat(shift): ผูก Payment เข้ากับกะที่เปิดอยู่ในทรานแซกชันเดียวกับการรับเงิน"
```

---

### Task 2: เปิดกะ

**Files:**
- Create: `prisma/migrations/<timestamp>_one_open_shift_per_branch/migration.sql`
- Create: `lib/server/shift.ts`
- Modify: `lib/rbac.ts` · `lib/audit-log.ts` · `lib/realtime-events.ts` · `scripts/smoke-shift.ts`

**Interfaces:**
- Consumes: `resolveOpenShiftId()` จาก Task 1
- Produces:
  - `canManageShift(role: StaffRole): boolean` · `canViewShiftHistory(role: StaffRole): boolean`
  - `openShift(staff: CurrentStaff, input: { openingFloat: number }): Promise<{ ok: true; shiftId: string } | { ok: false; error: string }>`
  - `getOpenShift(branchId: string)` — คืนแถว `Shift` หรือ null

- [ ] **Step 1: เพิ่มสิทธิ์ ป้าย และ event (ของที่เทสต์ต้องใช้)**

ใน `lib/rbac.ts` ต่อท้ายไฟล์:

```ts
/**
 * เปิด/ปิดกะ และดู X report (บทที่ 15)
 *
 * ชุดเดียวกับ canTakePayment() โดยตั้งใจ — **คนถือลิ้นชักคือคนนับเงิน**
 * ถ้าให้เฉพาะผู้จัดการปิดกะ ร้านที่ผู้จัดการกลับก่อนจะปิดกะไม่ได้เลย
 * แล้วเงินจะค้างอยู่ในกะที่ไม่มีวันปิด ซึ่งแย่กว่าการให้แคชเชียร์ปิดเอง
 * (ตัวคุมคือ AuditLog ที่เก็บส่วนต่างทุกครั้ง + หน้าประวัติที่ผู้จัดการอ่านย้อนหลังได้)
 */
export function canManageShift(role: StaffRole): boolean {
  return canTakePayment(role);
}

/**
 * เปิดหน้าประวัติกะย้อนหลังทั้งสาขา (บทที่ 15)
 *
 * **แคบกว่า canManageShift() ด้วยเหตุผลเดียวกับ canBrowseReceipts():**
 * ปิดกะของตัวเอง = งานประจำวันของคนถือลิ้นชัก · ลิสต์ทุกกะย้อนหลัง =
 * เห็นยอดขายทั้งร้านและส่วนต่างเงินสดของเพื่อนร่วมงานทุกคน
 */
export function canViewShiftHistory(role: StaffRole): boolean {
  return role === "OWNER" || role === "MANAGER";
}
```

ใน `lib/audit-log.ts` เพิ่มสองบรรทัดใน `AUDIT_ACTION_LABEL`:

```ts
  "shift.open": "เปิดกะ",
  "shift.close": "ปิดกะ",
```

ใน `lib/realtime-events.ts` เพิ่มค่าใน union `RealtimeEventType` (ต่อจาก `"menu.changed"`):

```ts
  /**
   * เปิด/ปิดกะ (บทที่ 15) — event ระดับสาขา (`tableId: null`)
   *
   * **ห้ามใส่ใน CUSTOMER_BROADCAST_EVENTS** — "ปิดกะแล้ว" บอกลูกค้าได้ว่าร้าน
   * สรุปยอดไปแล้ว ซึ่งเป็นข้อมูลของร้าน ไม่ใช่ของลูกค้า
   */
  | "shift.changed"
```

- [ ] **Step 2: เขียนเคสที่ยังไม่ผ่าน**

ใน `scripts/smoke-shift.ts` เพิ่ม import และเคสต่อจากส่วนของ Task 1
(ก่อนบล็อกล้างข้อมูล):

```ts
import { openShift, getOpenShift } from "@/lib/server/shift";
```

```ts
  console.log("\n── เปิดกะ ──────────────────────────────────────────────────────\n");

  const kitchen = await loadStaff("seed-staff-kitchen");
  const noRight = await openShift(kitchen, { openingFloat: 100000 });
  check("ครัวเปิดกะไม่ได้", noRight.ok === false, noRight.ok ? "" : noRight.error);

  const badFloat = await openShift(cashier, { openingFloat: -1 });
  check("เงินทอนตั้งต้นติดลบ = error", badFloat.ok === false, badFloat.ok ? "" : badFloat.error);

  const opened = await openShift(cashier, { openingFloat: 100000 });
  check("เปิดกะสำเร็จ", opened.ok === true, opened.ok ? "" : opened.error);

  const current = await getOpenShift(branchId);
  check("getOpenShift() เจอกะที่เพิ่งเปิด", current?.id === (opened.ok ? opened.shiftId : ""));
  check("เก็บเงินทอนตั้งต้นไว้ถูก", current?.openingFloat === 100000, `${current?.openingFloat}`);
  check("บันทึกคนเปิดกะ", current?.openedByStaffId === cashier.id);

  const twice = await openShift(cashier, { openingFloat: 50000 });
  check("เปิดกะซ้อนขณะมีกะเปิดอยู่ = error", twice.ok === false, twice.ok ? "" : twice.error);
  check(
    "เปิดซ้อนไม่สำเร็จแล้วต้องไม่มีกะที่สองค้างในฐาน",
    (await prisma.shift.count({ where: { branchId, status: "OPEN" } })) === 1,
  );

  const otherBranch = await prisma.branch.findFirst({ where: { id: { not: branchId } } });

  if (otherBranch) {
    check(
      "กะของสาขาอื่นไม่โผล่มาที่สาขานี้",
      (await getOpenShift(otherBranch.id)) === null,
    );
  }

  const openLog = await prisma.auditLog.findFirst({
    where: { action: "shift.open", entityId: opened.ok ? opened.shiftId : "" },
  });
  const openMeta = (openLog?.metadata ?? {}) as Record<string, unknown>;
  check("เขียน AuditLog ตอนเปิดกะ", openLog !== null);
  check("AuditLog เก็บเงินทอนตั้งต้น", openMeta.openingFloat === 100000);
```

- [ ] **Step 3: รันให้เห็นว่าพัง**

Run: `npm run smoke:shift`
Expected: FAIL — `Cannot find module '@/lib/server/shift'`

- [ ] **Step 4: migration กันสองกะเปิดพร้อมกัน**

```bash
npx prisma migrate dev --create-only --name one_open_shift_per_branch
```

แล้ว **เขียน SQL เองทั้งไฟล์** (generator จะสร้างไฟล์เปล่าเพราะ schema ไม่เปลี่ยน) —
Prisma ประกาศ partial unique index ใน schema ไม่ได้ จึงต้องเขียนมือ:

```sql
-- หนึ่งสาขามีกะที่เปิดอยู่ได้ทีละหนึ่งกะเท่านั้น
--
-- ตรวจในโค้ดอย่างเดียวไม่พอ เพราะ "อ่านว่ายังไม่มีกะเปิด" กับ "สร้างแถวใหม่"
-- เป็นสองคำสั่งที่มีช่องว่างระหว่างกัน สองเครื่องที่กดเปิดกะพร้อมกันจะได้สองกะ
-- แล้วเงินจะกระจายลงกะที่ไม่มีใครดูใบเดียว
--
-- partial index (WHERE status = 'OPEN') ประกาศใน schema.prisma ไม่ได้ ต้องเขียน SQL เอง
CREATE UNIQUE INDEX "shifts_one_open_per_branch"
  ON "shifts" ("branchId")
  WHERE "status" = 'OPEN';
```

Run: `npx prisma migrate dev`
Expected: `Applied` · ถ้า `npm run dev` เปิดค้างอยู่ **ต้องรีสตาร์ท dev server**

- [ ] **Step 5: เขียน `lib/server/shift.ts`**

```ts
import "server-only";

import { canManageShift } from "@/lib/rbac";
import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * กะการขาย (บทที่ 15)
 *
 * ── หนึ่งสาขา = หนึ่งกะที่เปิดอยู่ ──────────────────────────────────────
 * ร้านมีลิ้นชักเดียว ใครรับเงินก็เข้ากะเดียวกัน — ถ้าวันหนึ่งต้องมีหลายลิ้นชัก
 * ต้องเพิ่มคอลัมน์ `register` ที่ `Shift` **ห้ามแก้เป็น "หนึ่งคนหนึ่งกะ" เฉย ๆ**
 * เพราะเงินในลิ้นชักใบเดียวจะถูกนับซ้ำโดยสองคน
 *
 * ── ระบบกะไม่ใช่ด่านขวางการขาย ─────────────────────────────────────────
 * ไม่มีกะเปิดก็รับเงินได้ (`Payment.shiftId = null`) เงินพวกนั้นถูกนับแยกและ
 * แสดงบนหน้าเปิดกะ — ร้านที่ลืมเปิดกะต้องขายได้ต่อไป ไม่ใช่หยุดรับเงินทั้งร้าน
 */

/** กะที่เปิดอยู่ของสาขานี้ — null = ยังไม่ได้เปิดกะ */
export async function getOpenShift(branchId: string) {
  return prisma.shift.findFirst({
    where: { branchId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });
}

export async function openShift(staff: CurrentStaff, input: { openingFloat: number }) {
  // การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์ — action ถูกยิงตรงด้วย POST ได้
  if (!canManageShift(staff.role)) {
    return { ok: false as const, error: "ตำแหน่งของคุณเปิดกะไม่ได้" };
  }

  if (!Number.isInteger(input.openingFloat) || input.openingFloat < 0) {
    return { ok: false as const, error: "เงินทอนตั้งต้นต้องเป็นจำนวนเงินที่ไม่ติดลบ" };
  }

  try {
    const shift = await prisma.$transaction(async (tx) => {
      const created = await tx.shift.create({
        data: {
          branchId: staff.branchId,
          openedByStaffId: staff.id,
          openingFloat: input.openingFloat,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          branchId: staff.branchId,
          staffId: staff.id,
          action: "shift.open",
          entityType: "shift",
          entityId: created.id,
          metadata: { openingFloat: input.openingFloat },
        },
      });

      return created;
    });

    await publishRealtimeEvent({
      v: REALTIME_EVENT_VERSION,
      type: "shift.changed",
      branchId: staff.branchId,
      tableId: null,
      at: Date.now(),
    });

    return { ok: true as const, shiftId: shift.id };
  } catch (error) {
    /**
     * ชนกับ partial unique index = มีกะเปิดอยู่แล้ว
     *
     * ปล่อยให้ฐานเป็นคนตอบแทนที่จะ "อ่านก่อนแล้วค่อยสร้าง" เพราะสองคำสั่งนั้น
     * มีช่องว่างระหว่างกัน — สองเครื่องที่กดพร้อมกันจะผ่านด่านอ่านทั้งคู่
     */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, error: "มีกะที่เปิดอยู่แล้ว ต้องปิดกะเดิมก่อน" };
    }

    throw error;
  }
}
```

- [ ] **Step 6: รันเทสต์ให้ผ่าน**

Run: `npm run smoke:shift`
Expected: PASS ทุกเคส · FAIL 0

Run: `npx tsc --noEmit && npx eslint .`
Expected: ไม่มี output

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations lib/server/shift.ts lib/rbac.ts lib/audit-log.ts lib/realtime-events.ts scripts/smoke-shift.ts
git commit -m "feat(shift): เปิดกะ + partial unique index กันสองกะเปิดพร้อมกัน"
```

---

### Task 3: X report — สรุปสดระหว่างกะ

**Files:**
- Modify: `lib/server/shift.ts` · `scripts/smoke-shift.ts`

**Interfaces:**
- Consumes: `getOpenShift()` จาก Task 2
- Produces:
  ```ts
  type ShiftReport = {
    shift: Shift;
    expectedCash: number;
    cashTotal: number;
    salesTotal: number;
    billCount: number;
    byMethod: Record<"CASH" | "QR" | "CARD", { count: number; total: number }>;
    bySalePoint: Record<"DINE_IN" | "TAKEAWAY" | "DELIVERY", { count: number; total: number }>;
    discountTotal: number;
    staffMealCount: number;
  };
  getShiftReport(branchId: string, shiftId: string): Promise<ShiftReport | null>
  getCashOutsideShift(branchId: string): Promise<{ total: number; count: number; firstAt: Date | null; lastAt: Date | null }>
  ```

- [ ] **Step 1: เขียนเคสที่ยังไม่ผ่าน**

ต่อใน `scripts/smoke-shift.ts` (แก้ import เป็น
`import { getCashOutsideShift, getOpenShift, getShiftReport, openShift } from "@/lib/server/shift";`):

```ts
  console.log("\n── X report ────────────────────────────────────────────────────\n");

  const shiftId = opened.ok ? opened.shiftId : "";

  const cash1 = await sellOneBill(cashier, table.id, "CASH", 2);
  const cash2 = await sellOneBill(cashier, table.id, "CASH", 1);
  const qr1 = await sellOneBill(cashier, table.id, "QR", 3);

  const report = await getShiftReport(branchId, shiftId);

  check("อ่าน X report ได้", report !== null);
  check(
    "ยอดขายรวมนับทุกช่องทางการจ่าย",
    report!.salesTotal === cash1.total + cash2.total + qr1.total,
    `${report!.salesTotal} vs ${cash1.total + cash2.total + qr1.total}`,
  );
  check("จำนวนบิลถูกต้อง", report!.billCount === 3, `${report!.billCount}`);
  check(
    "ยอดเงินสดนับเฉพาะบิลเงินสด (QR ไม่เข้าลิ้นชัก)",
    report!.cashTotal === cash1.total + cash2.total,
    `${report!.cashTotal} vs ${cash1.total + cash2.total}`,
  );
  check(
    "เงินสดที่ควรมี = เงินทอนตั้งต้น + ยอดขายเงินสด",
    report!.expectedCash === 100000 + cash1.total + cash2.total,
    `${report!.expectedCash}`,
  );
  check(
    "ใช้ grandTotal ไม่ใช่ receivedAmount (บิลจ่ายเกินแล้วทอนต้องไม่ทำให้ยอดพอง)",
    report!.expectedCash < 100000 + cash1.total + cash2.total + 10000,
  );
  check(
    "แยกตามวิธีจ่ายถูกต้อง",
    report!.byMethod.CASH.count === 2 && report!.byMethod.QR.count === 1,
    `CASH ${report!.byMethod.CASH.count} · QR ${report!.byMethod.QR.count}`,
  );
  check(
    "แยกตามช่องทางขายถูกต้อง (โต๊ะนั่งสามใบ)",
    report!.bySalePoint.DINE_IN.count === 3,
    `${report!.bySalePoint.DINE_IN.count}`,
  );

  // บิลใบแรกของไฟล์นี้ถูกรับตอนไม่มีกะ — ต้องไม่ถูกนับเข้ากะ แต่ต้องมองเห็นได้
  check(
    "เงินที่รับนอกกะไม่ถูกนับเข้ากะ",
    report!.billCount === 3,
  );

  const outsideCash = await getCashOutsideShift(branchId);
  check(
    "รายงานเงินสดนอกกะให้เห็นได้",
    outsideCash.count === 2 && outsideCash.total === outside.total + afterClose.total,
    `${outsideCash.count} บิล ${outsideCash.total}`,
  );
  check("บอกช่วงเวลาของเงินนอกกะได้", outsideCash.firstAt !== null && outsideCash.lastAt !== null);

  check("X report ของกะที่ไม่มีอยู่คืน null", (await getShiftReport(branchId, "ไม่มีจริง")) === null);

  if (otherBranch) {
    check(
      "X report ข้ามสาขาคืน null",
      (await getShiftReport(otherBranch.id, shiftId)) === null,
    );
  }
```

- [ ] **Step 2: รันให้เห็นว่าพัง**

Run: `npm run smoke:shift`
Expected: FAIL — `getShiftReport is not a function`

- [ ] **Step 3: เขียน `getShiftReport()` และ `getCashOutsideShift()`**

ต่อใน `lib/server/shift.ts`:

```ts
import type { PaymentMethod, OrderType } from "@/lib/generated/prisma/enums";

/** วิธีจ่ายที่ต้องมีบรรทัดในใบสรุปเสมอ แม้ยอดเป็นศูนย์ — คนอ่านต้องเห็นว่าไม่มี ไม่ใช่หาไม่เจอ */
const REPORTED_METHODS: readonly PaymentMethod[] = ["CASH", "QR", "CARD"];
const REPORTED_SALE_POINTS: readonly OrderType[] = ["DINE_IN", "TAKEAWAY", "DELIVERY"];

function emptyBuckets<T extends string>(keys: readonly T[]) {
  return Object.fromEntries(keys.map((key) => [key, { count: 0, total: 0 }])) as Record<
    T,
    { count: number; total: number }
  >;
}

/**
 * สรุปสดของกะที่ยังเปิดอยู่ (X report) — **ไม่บันทึกอะไรเลย**
 *
 * ดูกี่ครั้งก็ได้ ไม่ทิ้งร่องรอย ต่างจากการปิดกะที่เขียน snapshot ลงแถว Shift
 *
 * **รับเฉพาะกะที่ยังเปิดอยู่** — กะที่ปิดแล้วต้องอ่านผ่าน `getShift()` เท่านั้น
 * ไม่งั้นจะมีสองทางที่ให้ตัวเลขของกะเดียวกัน แล้ววันหนึ่งสองทางนั้นจะไม่ตรงกัน
 * (คิดสดจะขยับตามอัตราภาษีที่เปลี่ยน ส่วน snapshot ไม่ขยับ)
 */
export async function getShiftReport(branchId: string, shiftId: string) {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, branchId, status: "OPEN" },
  });

  if (!shift) {
    return null;
  }

  const payments = await prisma.payment.findMany({
    where: { shiftId: shift.id, branchId },
    select: {
      method: true,
      grandTotal: true,
      discountAmount: true,
      staffCustomerId: true,
      tableSession: { select: { table: { select: { kind: true } } } },
    },
  });

  return summarizePayments(shift, payments);
}

/** แกนกลางที่ทั้ง X report และการปิดกะใช้ร่วมกัน — ห้ามคิดยอดซ้ำอีกที่ */
function summarizePayments(
  shift: { id: string; openingFloat: number },
  payments: {
    method: PaymentMethod;
    grandTotal: number;
    discountAmount: number;
    staffCustomerId: string | null;
    tableSession: { table: { kind: "DINE_IN" | "COUNTER" | "DELIVERY" } };
  }[],
) {
  const byMethod = emptyBuckets(REPORTED_METHODS);
  const bySalePoint = emptyBuckets(REPORTED_SALE_POINTS);

  let salesTotal = 0;
  let cashTotal = 0;
  let discountTotal = 0;
  let staffMealCount = 0;

  for (const payment of payments) {
    salesTotal += payment.grandTotal;
    discountTotal += payment.discountAmount;

    if (payment.staffCustomerId) {
      staffMealCount += 1;
    }

    /**
     * เงินที่ "เข้าลิ้นชัก" คือ `grandTotal` ไม่ใช่ `receivedAmount`
     * — ลูกค้ายื่นแบงก์พันจ่ายค่าอาหาร 132 บาท เงินที่ค้างอยู่ในลิ้นชักคือ 132
     * ส่วนอีก 868 ทอนออกไปแล้ว (`changeAmount`)
     */
    if (payment.method === "CASH") {
      cashTotal += payment.grandTotal;
    }

    byMethod[payment.method].count += 1;
    byMethod[payment.method].total += payment.grandTotal;

    // ORDER_TYPE_FOR_SALE_POINT ของ lib/sale-point.ts แปลง kind → OrderType ให้แล้ว
    const salePoint: OrderType =
      payment.tableSession.table.kind === "DINE_IN"
        ? "DINE_IN"
        : payment.tableSession.table.kind === "COUNTER"
          ? "TAKEAWAY"
          : "DELIVERY";

    bySalePoint[salePoint].count += 1;
    bySalePoint[salePoint].total += payment.grandTotal;
  }

  return {
    shift,
    expectedCash: shift.openingFloat + cashTotal,
    cashTotal,
    salesTotal,
    billCount: payments.length,
    byMethod,
    bySalePoint,
    discountTotal,
    staffMealCount,
  };
}

export type ShiftReport = NonNullable<Awaited<ReturnType<typeof getShiftReport>>>;

/**
 * เงินสดที่รับตอนไม่มีกะเปิดอยู่ — ยอดที่ **ไม่ถูกนับเข้ากะไหนเลย**
 *
 * ต้องมองเห็นได้ ไม่ใช่หายเงียบ: คนที่เปิดกะเช้าวันถัดไปจะเจอเงินเกินในลิ้นชัก
 * แล้วไม่มีทางรู้ว่ามาจากไหน ถ้าหน้าจอไม่บอก
 *
 * นับเฉพาะที่ยังไม่ถูก "กลืน" เข้ากะไหน คือ `shiftId = null` ตรง ๆ
 */
export async function getCashOutsideShift(branchId: string) {
  const rows = await prisma.payment.aggregate({
    where: { branchId, shiftId: null, method: "CASH" },
    _sum: { grandTotal: true },
    _count: { _all: true },
    _min: { paidAt: true },
    _max: { paidAt: true },
  });

  return {
    total: rows._sum.grandTotal ?? 0,
    count: rows._count._all,
    firstAt: rows._min.paidAt,
    lastAt: rows._max.paidAt,
  };
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm run smoke:shift`
Expected: PASS ทุกเคส · FAIL 0

- [ ] **Step 5: Commit**

```bash
git add lib/server/shift.ts scripts/smoke-shift.ts
git commit -m "feat(shift): X report สรุปสดระหว่างกะ + ยอดเงินสดนอกกะ"
```

---

### Task 4: ปิดกะ

**Files:**
- Modify: `lib/server/shift.ts` · `scripts/smoke-shift.ts`

**Interfaces:**
- Consumes: `summarizePayments()` (ภายในไฟล์เดียวกัน) จาก Task 3
- Produces:
  - `closeShift(staff, input: { shiftId: string; countedCash: number; note?: string | null }): Promise<{ ok: true; shiftId: string; alreadyClosed: boolean } | { ok: false; error: string }>`
  - `getShift(branchId: string, shiftId: string)` — อ่าน snapshot อย่างเดียว

- [ ] **Step 1: เขียนเคสที่ยังไม่ผ่าน**

ต่อใน `scripts/smoke-shift.ts`:

```ts
  console.log("\n── ปิดกะ ───────────────────────────────────────────────────────\n");

  const expectedBefore = report!.expectedCash;

  const noRightClose = await closeShift(kitchen, { shiftId, countedCash: expectedBefore });
  check("ครัวปิดกะไม่ได้", noRightClose.ok === false, noRightClose.ok ? "" : noRightClose.error);

  // ส่วนต่างไม่เป็นศูนย์แต่ไม่กรอกเหตุผล = ไม่ยอมปิด
  const noNote = await closeShift(cashier, { shiftId, countedCash: expectedBefore - 5000 });
  check(
    "ส่วนต่างไม่เป็นศูนย์แล้วไม่กรอกหมายเหตุ = error",
    noNote.ok === false,
    noNote.ok ? "" : noNote.error,
  );
  check(
    "ปฏิเสธแล้วกะต้องยังเปิดอยู่",
    (await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).status === "OPEN",
  );

  const closed = await closeShift(cashier, {
    shiftId,
    countedCash: expectedBefore - 5000,
    note: "ทอนผิดตอนบ่าย",
  });
  check("ปิดกะสำเร็จ", closed.ok === true, closed.ok ? "" : closed.error);

  const snapshot = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  check("สถานะเป็น CLOSED", snapshot.status === "CLOSED", snapshot.status);
  check("บันทึกเวลาและคนปิด", snapshot.closedAt !== null && snapshot.closedByStaffId === cashier.id);
  check("snapshot เงินที่ควรมี", snapshot.expectedCash === expectedBefore, `${snapshot.expectedCash}`);
  check("snapshot เงินที่นับได้", snapshot.countedCash === expectedBefore - 5000);
  check("ส่วนต่างเป็นลบเมื่อเงินขาด", snapshot.cashDifference === -5000, `${snapshot.cashDifference}`);
  check("snapshot ยอดขายและจำนวนบิล", snapshot.salesTotal === report!.salesTotal && snapshot.billCount === 3);
  check("เก็บหมายเหตุไว้", snapshot.note === "ทอนผิดตอนบ่าย");

  const breakdown = (snapshot.breakdown ?? {}) as {
    byMethod?: Record<string, { count: number; total: number }>;
  };
  check(
    "breakdown เก็บยอดแยกวิธีจ่าย",
    breakdown.byMethod?.CASH?.count === 2 && breakdown.byMethod?.QR?.count === 1,
  );

  const again = await closeShift(cashier, { shiftId, countedCash: 1, note: "กดซ้ำ" });
  check("ปิดกะที่ปิดไปแล้ว = คืนใบเดิม ไม่ใช่ error", again.ok === true && again.alreadyClosed);
  check(
    "กดซ้ำแล้วตัวเลขเดิมต้องไม่ถูกเขียนทับ",
    (await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).countedCash ===
      expectedBefore - 5000,
  );

  const closeLog = await prisma.auditLog.findFirst({
    where: { action: "shift.close", entityId: shiftId },
  });
  const closeMeta = (closeLog?.metadata ?? {}) as Record<string, unknown>;
  check("เขียน AuditLog ตอนปิดกะ", closeLog !== null);
  check(
    "AuditLog เก็บส่วนต่างเงินสด (ตัวเลขที่ต้องสืบย้อนได้)",
    closeMeta.expectedCash === expectedBefore &&
      closeMeta.countedCash === expectedBefore - 5000 &&
      closeMeta.cashDifference === -5000,
  );

  check("getShift() อ่านกะที่ปิดแล้วได้", (await getShift(branchId, shiftId))?.id === shiftId);
  check(
    "X report ไม่รับกะที่ปิดแล้ว (มีทางอ่านทางเดียว)",
    (await getShiftReport(branchId, shiftId)) === null,
  );

  // ── ตัวเลขที่ปิดไปแล้วต้องไม่ขยับ แม้แก้อัตราภาษีทีหลัง ──
  const branchBefore = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
  await prisma.branch.update({ where: { id: branchId }, data: { vatRateBp: 1400 } });
  check(
    "แก้ VAT แล้วยอดในใบสรุปกะที่ปิดแล้วไม่ขยับ",
    (await getShift(branchId, shiftId))?.salesTotal === report!.salesTotal,
  );
  await prisma.branch.update({
    where: { id: branchId },
    data: { vatRateBp: branchBefore.vatRateBp },
  });
```

แก้ import ที่หัวไฟล์เป็น:

```ts
import {
  closeShift,
  getCashOutsideShift,
  getOpenShift,
  getShift,
  getShiftReport,
  openShift,
} from "@/lib/server/shift";
```

- [ ] **Step 2: รันให้เห็นว่าพัง**

Run: `npm run smoke:shift`
Expected: FAIL — `closeShift is not a function`

- [ ] **Step 3: เขียน `closeShift()` และ `getShift()`**

ต่อใน `lib/server/shift.ts`:

```ts
/** กะใบหนึ่งพร้อม snapshot ที่บันทึกไว้ตอนปิด — ห้ามคิดยอดใหม่จากตรงนี้ */
export async function getShift(branchId: string, shiftId: string) {
  return prisma.shift.findFirst({
    where: { id: shiftId, branchId },
    include: {
      openedByStaff: { select: { name: true } },
      closedByStaff: { select: { name: true } },
      branch: { select: { name: true, currency: true, timezone: true } },
    },
  });
}

export async function closeShift(
  staff: CurrentStaff,
  input: { shiftId: string; countedCash: number; note?: string | null },
) {
  if (!canManageShift(staff.role)) {
    return { ok: false as const, error: "ตำแหน่งของคุณปิดกะไม่ได้" };
  }

  if (!Number.isInteger(input.countedCash) || input.countedCash < 0) {
    return { ok: false as const, error: "ยอดเงินที่นับได้ต้องเป็นจำนวนเงินที่ไม่ติดลบ" };
  }

  const note = input.note?.trim() ?? "";

  return prisma.$transaction(async (tx) => {
    /**
     * อ่านและตรวจก่อน แต่ยังไม่เขียน — ต้องรู้ยอดก่อนถึงจะตัดสินได้ว่า
     * "ส่วนต่างไม่เป็นศูนย์แล้วไม่มีหมายเหตุ" ซึ่งเป็นเหตุผลที่ปฏิเสธได้
     */
    const shift = await tx.shift.findFirst({ where: { id: input.shiftId, branchId: staff.branchId } });

    if (!shift) {
      return { ok: false as const, error: "ไม่พบกะนี้ในสาขาของคุณ" };
    }

    if (shift.status === "CLOSED") {
      // กดซ้ำ = คืนใบเดิม ไม่ใช่ error (ท่าเดียวกับกันจ่ายซ้ำของบทที่ 11)
      return { ok: true as const, shiftId: shift.id, alreadyClosed: true };
    }

    const payments = await tx.payment.findMany({
      where: { shiftId: shift.id, branchId: staff.branchId },
      select: {
        method: true,
        grandTotal: true,
        discountAmount: true,
        staffCustomerId: true,
        tableSession: { select: { table: { select: { kind: true } } } },
      },
    });

    const summary = summarizePayments(shift, payments);
    const difference = input.countedCash - summary.expectedCash;

    /**
     * ส่วนต่างที่ไม่มีคำอธิบายคือสิ่งที่ตรวจสอบย้อนหลังไม่ได้เลย
     *
     * บังคับกรอกตรงนี้ ไม่ใช่แค่ที่หน้าจอ เพราะ action ถูกยิงตรงด้วย POST ได้
     */
    if (difference !== 0 && note.length < 3) {
      return {
        ok: false as const,
        error: "เงินไม่ตรงกับที่ระบบคำนวณ กรุณากรอกหมายเหตุอย่างน้อย 3 ตัวอักษร",
      };
    }

    /**
     * ปิดแบบมีเงื่อนไข = คำสั่งที่ทั้งตรวจและเขียนในครั้งเดียว
     *
     * สองเครื่องที่กดปิดพร้อมกัน เครื่องที่สองรอ row lock แล้วอ่าน WHERE ใหม่
     * (Postgres READ COMMITTED) ได้ count = 0 → คืนใบเดิม ไม่ใช่เขียนทับตัวเลข
     * ของเครื่องแรกด้วยยอดที่นับคนละครั้ง
     *
     * การรวมยอดอยู่ในทรานแซกชันเดียวกับการปิด — ถ้าแยกออกไป บิลที่จ่าย
     * ระหว่างนั้นจะหายจากทั้งสองกะ (ไม่อยู่ในใบที่ปิด เพราะรวมยอดไปก่อนแล้ว ·
     * ไม่อยู่ในกะถัดไป เพราะ shiftId ชี้กะที่ปิดไปแล้ว)
     */
    const claimed = await tx.shift.updateMany({
      where: { id: shift.id, status: "OPEN" },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedByStaffId: staff.id,
        countedCash: input.countedCash,
        expectedCash: summary.expectedCash,
        cashDifference: difference,
        salesTotal: summary.salesTotal,
        billCount: summary.billCount,
        breakdown: {
          byMethod: summary.byMethod,
          bySalePoint: summary.bySalePoint,
          discountTotal: summary.discountTotal,
          staffMealCount: summary.staffMealCount,
        },
        note: note.length > 0 ? note : null,
      },
    });

    if (claimed.count === 0) {
      return { ok: true as const, shiftId: shift.id, alreadyClosed: true };
    }

    await tx.auditLog.create({
      data: {
        branchId: staff.branchId,
        staffId: staff.id,
        action: "shift.close",
        entityType: "shift",
        entityId: shift.id,
        metadata: {
          expectedCash: summary.expectedCash,
          countedCash: input.countedCash,
          cashDifference: difference,
          salesTotal: summary.salesTotal,
          billCount: summary.billCount,
          note: note.length > 0 ? note : null,
        },
      },
    });

    return { ok: true as const, shiftId: shift.id, alreadyClosed: false };
  });
}
```

> **หมายเหตุเรื่อง event:** `closeShift()` คืนค่าจากใน `$transaction` โดยตรง จึงต้อง
> ยิง `shift.changed` **หลัง** ทรานแซกชันจบ — ห่อด้วยตัวแปรก่อนแล้วค่อย publish
> เหมือน `openShift()` (กฎ CLAUDE.md: ห้าม publish ใน transaction) ทำใน Step 4

- [ ] **Step 4: ยิง event หลัง commit**

แก้ `closeShift()` ให้เก็บผลลัพธ์ก่อนแล้วค่อยยิง event:

```ts
export async function closeShift(...) {
  // ...ด่านสิทธิ์และตรวจค่าเหมือนเดิม...

  const result = await prisma.$transaction(async (tx) => { /* ...เนื้อในเดิมทั้งหมด... */ });

  if (result.ok && !result.alreadyClosed) {
    await publishRealtimeEvent({
      v: REALTIME_EVENT_VERSION,
      type: "shift.changed",
      branchId: staff.branchId,
      tableId: null,
      at: Date.now(),
    });
  }

  return result;
}
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

Run: `npm run smoke:shift`
Expected: PASS ทุกเคส · FAIL 0

Run: `npx tsc --noEmit && npx eslint .`
Expected: ไม่มี output

- [ ] **Step 6: Commit**

```bash
git add lib/server/shift.ts scripts/smoke-shift.ts
git commit -m "feat(shift): ปิดกะแบบมีเงื่อนไข + snapshot ยอดลงแถว Shift"
```

---

### Task 5: จอ POS — เปิดกะ / X / ปิดกะ / ใบสรุป

**Files:**
- Create: `components/shift-summary.tsx` · `app/(pos)/pos/shift/page.tsx` ·
  `app/(pos)/pos/shift/[shiftId]/page.tsx` · `app/(pos)/pos/shift/_components/shift-forms.tsx`
- Modify: `app/(pos)/pos/actions.ts` · `app/(pos)/pos/_components/pos-sidebar.tsx` ·
  `app/(pos)/pos/page.tsx`

**Interfaces:**
- Consumes: `openShift` · `closeShift` · `getOpenShift` · `getShiftReport` · `getShift` ·
  `getCashOutsideShift` · `canManageShift`
- Produces:
  - `openShiftAction(prev: FormState, formData: FormData): Promise<FormState>`
  - `closeShiftAction(prev: FormState, formData: FormData): Promise<FormState>`
  - `<ShiftSummary shift={...} currency={...} timezone={...} />` — ใบสรุปที่ใช้ร่วมกันสามที่

- [ ] **Step 1: สอง action ใน `app/(pos)/pos/actions.ts`**

เพิ่ม import:

```ts
import { closeShift, openShift } from "@/lib/server/shift";
import { parseMoneyInput } from "@/lib/money";
```

แล้วต่อท้ายไฟล์:

```ts
/**
 * เปิดกะ (บทที่ 15)
 *
 * เงินทอนตั้งต้นมาจากช่องกรอกจึงเป็นสตริง — แปลงด้วย `parseMoneyInput()` ตัวเดียว
 * กับที่หน้ารับเงินใช้ **ห้ามคูณ 100 เอง** (`19.99 * 100 === 1998.9999999999998`)
 */
export async function openShiftAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const openingFloat = parseMoneyInput(
    String(formData.get("openingFloat") ?? ""),
    staff.branch.currency,
  );

  if (openingFloat === null) {
    return { status: "error", message: "กรอกเงินทอนตั้งต้นเป็นตัวเลข" };
  }

  const result = await openShift(staff, { openingFloat });

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  refresh();

  return { status: "success", message: "เปิดกะแล้ว" };
}

/** ปิดกะแล้วพาไปหน้าใบสรุปทันที — ใบสรุปคือสิ่งที่คนปิดกะต้องการต่อจากนั้นเสมอ */
export async function closeShiftAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const countedCash = parseMoneyInput(
    String(formData.get("countedCash") ?? ""),
    staff.branch.currency,
  );

  if (countedCash === null) {
    return { status: "error", message: "กรอกยอดเงินที่นับได้เป็นตัวเลข" };
  }

  const result = await closeShift(staff, {
    shiftId: String(formData.get("shiftId") ?? ""),
    countedCash,
    note: formData.get("note") ? String(formData.get("note")) : null,
  });

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  redirect(`/pos/shift/${result.shiftId}`);
}
```

- [ ] **Step 2: `components/shift-summary.tsx`**

```tsx
import type { Currency } from "@/lib/generated/prisma/enums";
import { formatMoney } from "@/lib/money";

/**
 * ใบสรุปกะ (Z report) — **component เดียวที่ใช้ทั้งจอ POS และจอหลังร้าน**
 *
 * ห้ามก๊อปเป็นสองชุด (ท่าเดียวกับ `receipt-document.tsx` ของบทที่ 12) —
 * สองชุดแปลว่าวันหนึ่งตัวเลขบนกระดาษกับตัวเลขบนจอผู้จัดการจะไม่ตรงกัน
 *
 * อ่านจาก **snapshot ในแถว Shift อย่างเดียว** ไม่ query สดซ้ำ: เปิดใบของเมื่อวาน
 * ดูปีหน้าต้องได้ตัวเลขเดิมเป๊ะ แม้อัตรา VAT จะเปลี่ยนไปแล้ว
 */
export function ShiftSummary({
  shift,
  currency,
  timezone,
}: {
  shift: {
    id: string;
    openedAt: Date;
    closedAt: Date | null;
    openingFloat: number;
    countedCash: number | null;
    expectedCash: number | null;
    cashDifference: number | null;
    salesTotal: number | null;
    billCount: number | null;
    breakdown: unknown;
    note: string | null;
    openedByStaff: { name: string } | null;
    closedByStaff: { name: string } | null;
  };
  currency: Currency;
  timezone: string;
}) {
  const time = (value: Date | null) =>
    value === null
      ? "—"
      : new Intl.DateTimeFormat("th-TH", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: timezone,
        }).format(value);

  const breakdown = (shift.breakdown ?? {}) as {
    byMethod?: Record<string, { count: number; total: number }>;
  };

  return (
    <article className="panel flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <p className="kicker">ใบสรุปกะ</p>
        <p className="display text-[22px]">
          {time(shift.openedAt)} — {time(shift.closedAt)}
        </p>
        <p className="text-[14px] text-[var(--color-neutral-700)]">
          เปิดโดย {shift.openedByStaff?.name ?? "—"} · ปิดโดย {shift.closedByStaff?.name ?? "—"}
        </p>
      </header>

      <div className="rule" />

      <dl className="flex flex-col gap-2 text-[15px]">
        <Row label="เงินทอนตั้งต้น" value={formatMoney(shift.openingFloat, currency)} />
        <Row label="ยอดขายรวม" value={formatMoney(shift.salesTotal ?? 0, currency)} />
        <Row label="จำนวนบิล" value={`${shift.billCount ?? 0} ใบ`} />
        {Object.entries(breakdown.byMethod ?? {}).map(([method, bucket]) => (
          <Row
            key={method}
            label={`— ${method === "CASH" ? "เงินสด" : method === "QR" ? "QR" : "บัตร"} (${bucket.count} ใบ)`}
            value={formatMoney(bucket.total, currency)}
          />
        ))}
      </dl>

      <div className="rule" />

      <dl className="flex flex-col gap-2 text-[15px]">
        <Row label="เงินสดที่ระบบคำนวณ" value={formatMoney(shift.expectedCash ?? 0, currency)} />
        <Row label="เงินสดที่นับได้จริง" value={formatMoney(shift.countedCash ?? 0, currency)} />
        <Row
          label="ส่วนต่าง"
          value={formatMoney(shift.cashDifference ?? 0, currency)}
          strong={(shift.cashDifference ?? 0) !== 0}
        />
      </dl>

      {shift.note ? <p className="text-[14px]">หมายเหตุ: {shift.note}</p> : null}

      {/* ระบบยังไม่มีการคืนเงิน — บอกตรง ๆ ดีกว่าใส่บรรทัดที่เป็น 0 ตลอดกาลให้เข้าใจผิด */}
      <p className="kicker">ระบบนี้ยังไม่มีการคืนเงิน ใบสรุปจึงไม่มีบรรทัดยอดคืน</p>
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "display" : undefined}>{label}</dt>
      <dd className={strong ? "display text-[18px]" : undefined}>{value}</dd>
    </div>
  );
}
```

- [ ] **Step 3: ฟอร์มเปิด/ปิดกะ (`app/(pos)/pos/shift/_components/shift-forms.tsx`)**

```tsx
"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";

import { closeShiftAction, openShiftAction } from "../../actions";

/** เปิดกะ — ช่องเดียวคือเงินทอนตั้งต้นที่นับใส่ลิ้นชักไว้ก่อนเริ่มขาย */
export function OpenShiftForm() {
  const [state, formAction] = useActionState<FormState, FormData>(
    openShiftAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="panel flex flex-col gap-3 p-6">
      <label className="flex flex-col gap-1">
        <span className="kicker">เงินทอนตั้งต้นในลิ้นชัก</span>
        <input
          name="openingFloat"
          type="text"
          inputMode="decimal"
          required
          placeholder="เช่น 1000"
          className="input display h-14 text-[18px]"
        />
      </label>

      {state.status === "error" ? (
        <p role="alert" className="alert">
          {state.message}
        </p>
      ) : null}

      <SubmitButton pendingLabel="กำลังเปิดกะ..." className="btn btn-primary h-14 text-base">
        เปิดกะ
      </SubmitButton>
    </form>
  );
}

/**
 * ปิดกะ — ซ่อนใน <details> เพราะเป็นปุ่มที่กดพลาดแล้วต้องเปิดกะใหม่ทั้งกะ
 * และแสดง "ระบบว่าควรมีเท่าไร" ไว้ข้าง ๆ ช่องกรอกเสมอ
 */
export function CloseShiftForm({
  shiftId,
  expectedLabel,
}: {
  shiftId: string;
  expectedLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    closeShiftAction,
    IDLE_FORM_STATE,
  );

  return (
    <details className="panel p-6">
      <summary className="kicker cursor-pointer">ปิดกะและนับเงิน</summary>

      <form action={formAction} className="flex flex-col gap-3 pt-4">
        <input type="hidden" name="shiftId" value={shiftId} />

        <p className="text-[15px]">
          ระบบคำนวณว่าในลิ้นชักควรมี <strong>{expectedLabel}</strong>
        </p>

        <label className="flex flex-col gap-1">
          <span className="kicker">นับได้จริงเท่าไร</span>
          <input
            name="countedCash"
            type="text"
            inputMode="decimal"
            required
            className="input display h-14 text-[18px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">หมายเหตุ (บังคับกรอกเมื่อเงินไม่ตรง)</span>
          <input
            name="note"
            type="text"
            maxLength={200}
            placeholder="เช่น ทอนผิดตอนบ่าย"
            className="input h-12"
          />
        </label>

        {state.status === "error" ? (
          <p role="alert" className="alert">
            {state.message}
          </p>
        ) : null}

        <SubmitButton pendingLabel="กำลังปิดกะ..." className="btn btn-primary h-14 text-base">
          ยืนยันปิดกะ
        </SubmitButton>
      </form>
    </details>
  );
}
```

- [ ] **Step 4: หน้า `/pos/shift`**

`app/(pos)/pos/shift/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveRefresh } from "@/components/live-refresh";
import { formatMoney } from "@/lib/money";
import { canManageShift } from "@/lib/rbac";
import { getCashOutsideShift, getOpenShift, getShiftReport } from "@/lib/server/shift";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { CloseShiftForm, OpenShiftForm } from "./_components/shift-forms";

/**
 * โมดูล 06 — กะการขาย (บทที่ 15)
 *
 * **จอเดียวสองโหมด** เหมือน `/pos/table/[id]/bill` ของบทที่ 11:
 * ไม่มีกะเปิด → ฟอร์มเปิดกะ · มีกะเปิด → X report สด + ฟอร์มปิดกะ
 * แยกเป็นสอง route แล้วพนักงานจะต้องจำว่าตอนนี้ต้องกดหน้าไหน ซึ่งเป็นสิ่งที่
 * ระบบตอบเองได้จากสถานะในฐาน
 */
export default async function PosShiftPage() {
  const staff = await getCurrentStaff("pos");

  if (!staff || !canManageShift(staff.role)) {
    redirect("/pos/login");
  }

  const currency = staff.branch.currency;
  const shift = await getOpenShift(staff.branchId);
  const report = shift ? await getShiftReport(staff.branchId, shift.id) : null;
  const outside = await getCashOutsideShift(staff.branchId);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
      <LiveRefresh src="/api/realtime" className="sr-only" />

      <h1 className="display mb-4 text-[26px]">กะการขาย</h1>

      {report === null ? (
        <div className="flex max-w-xl flex-col gap-4">
          {outside.count > 0 ? (
            <p className="alert">
              มีเงินสดที่รับไว้นอกกะ {formatMoney(outside.total, currency)} จาก {outside.count} บิล
              — เงินก้อนนี้ไม่ถูกนับเข้ากะไหน ให้ตรวจกับเงินในลิ้นชักก่อนเปิดกะใหม่
            </p>
          ) : null}

          <OpenShiftForm />
        </div>
      ) : (
        <div className="flex max-w-xl flex-col gap-4">
          <dl className="panel flex flex-col gap-2 p-6 text-[15px]">
            <Line label="ยอดขายในกะนี้" value={formatMoney(report.salesTotal, currency)} />
            <Line label="จำนวนบิล" value={`${report.billCount} ใบ`} />
            <Line label="เงินสดที่รับ" value={formatMoney(report.cashTotal, currency)} />
            <Line label="เงินทอนตั้งต้น" value={formatMoney(report.shift.openingFloat, currency)} />
            <Line
              label="เงินสดที่ควรมีในลิ้นชัก"
              value={formatMoney(report.expectedCash, currency)}
            />
          </dl>

          <CloseShiftForm
            shiftId={report.shift.id}
            expectedLabel={formatMoney(report.expectedCash, currency)}
          />
        </div>
      )}

      <Link href="/pos" className="kicker mt-6">
        ‹ กลับไปผังโต๊ะ
      </Link>
    </main>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className="display">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 5: หน้าใบสรุป `/pos/shift/[shiftId]`**

`app/(pos)/pos/shift/[shiftId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ShiftSummary } from "@/components/shift-summary";
import { canManageShift } from "@/lib/rbac";
import { getShift } from "@/lib/server/shift";
import { getCurrentStaff } from "@/lib/server/staff-session";

export default async function PosShiftSummaryPage({
  params,
}: {
  params: Promise<{ shiftId: string }>;
}) {
  const staff = await getCurrentStaff("pos");

  if (!staff || !canManageShift(staff.role)) {
    redirect("/pos/login");
  }

  const { shiftId } = await params;
  const shift = await getShift(staff.branchId, shiftId);

  if (!shift) {
    notFound();
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
      {/* ปุ่มกับลิงก์ต้องไม่ติดไปบนกระดาษ — กฎเดียวกับใบเสร็จบทที่ 12 */}
      <div data-print-hide className="mb-4 flex items-center justify-between gap-4">
        <Link href="/pos/shift" className="kicker">
          ‹ กลับไปหน้ากะ
        </Link>
      </div>

      <div className="max-w-md">
        <ShiftSummary
          shift={shift}
          currency={shift.branch.currency}
          timezone={shift.branch.timezone}
        />
      </div>
    </main>
  );
}
```

> ปุ่มพิมพ์ใช้ `components/receipt-print-button.tsx` ไม่ได้ (มันนับการพิมพ์ลง AuditLog
> ของใบเสร็จ) — ใบสรุปกะพิมพ์กี่ครั้งก็ได้ ไม่ต้องนับ ให้ผู้ใช้กด Ctrl+P เอง
> **ห้ามก๊อปปุ่มนั้นมาแก้** เพราะจะได้ตัวนับที่ชี้ผิดเอกสาร

- [ ] **Step 6: ทางเข้าสองจุด**

ใน `app/(pos)/pos/_components/pos-sidebar.tsx` เปลี่ยนโมดูล 06:

```ts
  {
    num: "06",
    label: "รายงาน / ปิดกะ",
    href: "/pos/shift",
    screen: "pos",
  },
```

ใน `app/(pos)/pos/page.tsx` เหนือผังโต๊ะ (ในโซนที่เลื่อนได้ ไม่ใช่หัวจอ) เพิ่มแถบเตือน
โดยดึงสถานะกะมาด้วย — เพิ่ม import `getOpenShift` แล้วใส่:

```tsx
      {openShiftRow === null ? (
        <Link href="/pos/shift" className="alert block">
          ยังไม่ได้เปิดกะ — เงินสดที่รับตอนนี้จะไม่ถูกนับเข้ากะไหน (กดเพื่อเปิดกะ)
        </Link>
      ) : null}
```

**ห้ามขวางการขาย** — เป็นแถบข้อความ ไม่ใช่ modal และไม่ปิดปุ่มใด ๆ

- [ ] **Step 7: ตรวจด้วยเซิร์ฟเวอร์จริง**

```bash
npm run build && npm run start -- -p 3002
npm run dev:staff-cookie 002 pos
```

ยิงด้วย cookie ที่ได้:

```bash
curl -s -H "Cookie: pos_staff_session=<token>" http://localhost:3002/pos/shift | grep -o "เปิดกะ\|เงินสดที่ควรมีในลิ้นชัก"
```

Expected: หน้ามีฟอร์มเปิดกะจริง · หลังเปิดกะแล้วหน้าเดิมเปลี่ยนเป็น X report ·
`/pos` มีแถบเตือนตอนยังไม่เปิดกะและหายไปหลังเปิด
**อ่าน HTML ที่เซิร์ฟเวอร์ส่งออกมาจริง ไม่ใช่เชื่อว่าโค้ดถูก**

- [ ] **Step 8: Commit**

```bash
git add components/shift-summary.tsx "app/(pos)/pos/shift" "app/(pos)/pos/actions.ts" "app/(pos)/pos/_components/pos-sidebar.tsx" "app/(pos)/pos/page.tsx"
git commit -m "feat(pos): จอกะ — เปิดกะ · X report · ปิดกะ · ใบสรุป"
```

---

### Task 6: จอหลังร้าน — ประวัติกะ

**Files:**
- Create: `app/(admin)/admin/shifts/page.tsx` · `app/(admin)/admin/shifts/[shiftId]/page.tsx`
- Modify: `lib/server/shift.ts` · `app/(admin)/admin/page.tsx` · `scripts/smoke-shift.ts`

**Interfaces:**
- Consumes: `getShift()` · `ShiftSummary` จาก Task 4-5
- Produces: `listShifts(branchId: string, options?: { limit?: number }): Promise<ShiftListRow[]>`
  โดย `ShiftListRow` มี `id · openedAt · closedAt · status · salesTotal · cashDifference · openedByStaff · closedByStaff`

- [ ] **Step 1: เขียนเคสที่ยังไม่ผ่าน**

ต่อใน `scripts/smoke-shift.ts`:

```ts
  console.log("\n── ประวัติกะ ───────────────────────────────────────────────────\n");

  const list = await listShifts(branchId);
  check("ลิสต์กะย้อนหลังเจอกะที่เพิ่งปิด", list.some((row) => row.id === shiftId));
  check(
    "ลิสต์เรียงจากใหม่ไปเก่า",
    list.length < 2 || list[0].openedAt >= list[1].openedAt,
  );
  check(
    "ลิสต์แนบส่วนต่างเงินสดมาด้วย (คอลัมน์ที่ผู้จัดการต้องกวาดตาหา)",
    list.find((row) => row.id === shiftId)?.cashDifference === -5000,
  );

  if (otherBranch) {
    check(
      "ลิสต์ไม่ข้ามสาขา",
      (await listShifts(otherBranch.id)).every((row) => row.id !== shiftId),
    );
  }
```

เพิ่ม `listShifts` เข้า import จาก `@/lib/server/shift`

- [ ] **Step 2: รันให้เห็นว่าพัง**

Run: `npm run smoke:shift`
Expected: FAIL — `listShifts is not a function`

- [ ] **Step 3: เขียน `listShifts()`**

ต่อใน `lib/server/shift.ts`:

```ts
/**
 * ประวัติกะย้อนหลังของสาขา — ใหม่สุดอยู่บนสุด
 *
 * ไม่แบ่งหน้าเหมือน `/admin/receipts` เพราะกะเกิดวันละหนึ่งถึงสามใบ
 * (30 ใบ ≈ หนึ่งเดือน) — ถ้าวันหนึ่งร้านมีหลายสาขาในหน้าเดียวค่อยเพิ่ม
 */
export async function listShifts(branchId: string, options: { limit?: number } = {}) {
  return prisma.shift.findMany({
    where: { branchId },
    orderBy: { openedAt: "desc" },
    take: options.limit ?? 60,
    include: {
      openedByStaff: { select: { name: true } },
      closedByStaff: { select: { name: true } },
    },
  });
}

export type ShiftListRow = Awaited<ReturnType<typeof listShifts>>[number];
```

- [ ] **Step 4: หน้า `/admin/shifts`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";

import { formatMoney } from "@/lib/money";
import { canAccessScreen, canViewShiftHistory } from "@/lib/rbac";
import { listShifts } from "@/lib/server/shift";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * ประวัติกะ (spec §14 "Managers should be able to review cash discrepancies")
 *
 * คอลัมน์ที่ผู้จัดการกวาดตาหาคือ **ส่วนต่าง** ไม่ใช่ยอดขาย จึงอยู่ขวาสุดและ
 * แถวที่ไม่เป็นศูนย์ถูกเน้น — ยอดขายดูที่หน้า "สรุปวันนี้" ได้อยู่แล้ว
 */
export default async function AdminShiftsPage() {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  // ตำแหน่งที่เข้าไม่ได้ถูกพากลับไปหน้าที่ทำงานได้ ไม่ใช่ขึ้นว่า "ไม่มีสิทธิ์"
  // (กติกาเดียวกับหน้าสรุปวันนี้ของก้อนก่อน)
  if (!canViewShiftHistory(staff.role)) {
    redirect("/admin/menu");
  }

  const currency = staff.branch.currency;
  const shifts = await listShifts(staff.branchId);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
      <h1 className="display mb-4 text-[26px]">ประวัติกะ</h1>

      {shifts.length === 0 ? (
        <p className="panel p-6">ยังไม่มีกะที่เปิดหรือปิดในสาขานี้</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shifts.map((shift) => (
            <li key={shift.id}>
              <Link href={`/admin/shifts/${shift.id}`} className="panel flex flex-wrap items-baseline justify-between gap-3 p-4">
                <span className="display text-[16px]">
                  {new Intl.DateTimeFormat("th-TH", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: staff.branch.timezone,
                  }).format(shift.openedAt)}
                </span>
                <span className="kicker">
                  {shift.status === "OPEN" ? "กำลังเปิดอยู่" : `ปิดโดย ${shift.closedByStaff?.name ?? "—"}`}
                </span>
                <span>{formatMoney(shift.salesTotal ?? 0, currency)}</span>
                <span className={shift.cashDifference ? "display text-[16px]" : "kicker"}>
                  ส่วนต่าง {formatMoney(shift.cashDifference ?? 0, currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

`app/(admin)/admin/shifts/[shiftId]/page.tsx` — เหมือนหน้าใบสรุปของ POS ทุกอย่าง
ยกเว้นด่านสิทธิ์ (`canViewShiftHistory` + `getCurrentStaff("admin")`) และลิงก์กลับไป
`/admin/shifts` · ตัวใบใช้ `<ShiftSummary />` ตัวเดิม **ห้ามเขียนใบใหม่**

- [ ] **Step 5: ทางเข้าจากหน้าสรุปวันนี้**

ใน `app/(admin)/admin/page.tsx` เพิ่มลิงก์ (ไม่เพิ่มโมดูลในแถบเมนู — เหตุผลอยู่ใน
Global Constraints):

```tsx
      <Link href="/admin/shifts" className="kicker">
        ดูประวัติกะและส่วนต่างเงินสด ›
      </Link>
```

- [ ] **Step 6: รันเทสต์ + ตรวจจอจริง**

```bash
npm run smoke:shift
npx tsc --noEmit && npx eslint . && npm run build
```

Expected: FAIL 0 · ไม่มี output จาก tsc/eslint · build ผ่าน

- [ ] **Step 7: Commit**

```bash
git add lib/server/shift.ts "app/(admin)/admin/shifts" "app/(admin)/admin/page.tsx" scripts/smoke-shift.ts
git commit -m "feat(admin): ประวัติกะ + ส่วนต่างเงินสดสำหรับผู้จัดการ"
```

---

### Task 7: ตรวจครบชุด + เอกสาร

**Files:**
- Create: `report/2026-08-25-chapter-15-shift.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: ตรวจครบ**

```bash
npx tsc --noEmit && npx eslint . && npm run build
for s in order pos kds bill payment menu receipt staff-meal takeaway staff-session staff-admin settings dashboard table-move shift; do
  echo -n "$s: "; npm run --silent smoke:$s 2>&1 | grep -cE "^FAIL"
done
```

Expected: **สิบห้าชุด FAIL 0 ทุกชุด**

- [ ] **Step 2: วัดจอ**

เตรียมข้อมูลก่อน (ต้องมีกะเปิดอยู่ + กะที่ปิดแล้วอย่างน้อยหนึ่งใบ) แล้ว:

```bash
npm run build && npm run start -- -p 3002
npm run dev:staff-cookie 002 pos
npm run dev:staff-cookie 002 admin
```

```bash
AUDIT_COOKIES='[{"name":"pos_staff_session","value":"<pos token>","domain":"localhost","path":"/"},{"name":"admin_staff_session","value":"<admin token>","domain":"localhost","path":"/"}]' \
AUDIT_PAGES='[{"path":"/pos/shift","openDetails":true,"mustSee":["เงินสดที่ควรมีในลิ้นชัก","ยืนยันปิดกะ"]},{"path":"/pos/shift/<id>","mustSee":["ส่วนต่าง"]},{"path":"/admin/shifts","mustSee":["ประวัติกะ"]}]' \
npm run audit:screens
```

Expected: 15/15 (3 หน้า × 5 ขนาด) · `openDetails: true` จำเป็นเพราะฟอร์มปิดกะอยู่ใน `<details>`

- [ ] **Step 3: ตรวจการพิมพ์**

เปิด `/pos/shift/<id>` แล้วสั่ง print preview — ใบต้องไม่ถูกตัด และ **ต้องไม่มีแถบหัวจอ
หรือแถบโมดูลติดไปบนกระดาษ** (ถ้ามี แปลว่าลืม `data-print-hide` — กับดักข้อ 2 ของบทที่ 12)

- [ ] **Step 4: เขียนรายงาน**

`report/2026-08-25-chapter-15-shift.md` — รูปแบบเดียวกับรายงานก้อนก่อน: อะไรเปลี่ยน ·
กฎที่ต้องรู้ก่อนแตะโค้ดส่วนนี้ · กับดักที่เจอจริง · **ตัวเลขที่ยืนยันด้วยของจริง**
(เงินทอนตั้งต้น + ยอดขายเงินสด = เงินที่ควรมี พร้อมเลขจริงจาก smoke) · สิ่งที่ยังไม่ได้ทำ

- [ ] **Step 5: อัปเดต `CLAUDE.md`**

เพิ่มหัวข้อสถานะของก้อนนี้ พร้อมกฎที่ต้องไม่ลืม:
- **`Payment.shiftId` อ่านในทรานแซกชันของการรับเงินเสมอ** ห้ามอ่านก่อน
- **`shift-current.ts` เป็น leaf module** ห้าม import `shift.ts` เข้า `payment.ts`
- **X คิดสด (เฉพาะกะที่เปิดอยู่) · ปิดกะ snapshot** — มีทางอ่านทางเดียวต่อสถานะ
- **เงินสดที่เข้าลิ้นชัก = `grandTotal` ไม่ใช่ `receivedAmount`**
- **partial unique index `shifts_one_open_per_branch`** — หนึ่งสาขาหนึ่งกะ
- **ไม่เพิ่มโมดูลที่เจ็ดในแถบหลังร้าน** ทางเข้าประวัติกะอยู่ที่หน้าสรุปวันนี้
- ปรับ "ก้อนถัดไป" เป็น **รายงานยอดขายย้อนหลัง** (spec §18)

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md report/2026-08-25-chapter-15-shift.md
git commit -m "docs: บันทึกก้อนบทที่ 15 (กะ/ปิดกะ)"
```

---

## Self-Review (ทำแล้วตอนเขียนแผน)

**Spec coverage** — ทุกหัวข้อของ spec มี Task รองรับ:
§3.1 สูตรเงินสด → Task 3 · §3.2 breakdown → Task 4 · §4.1 อ่านกะในทรานแซกชัน → Task 1 ·
§4.2 conditional close → Task 4 · §4.3 X สด/ปิด snapshot → Task 3-4 · §4.4 เงินนอกกะ → Task 3+5 ·
§5 โมดูลครบทุกไฟล์ → Task 1-6 · §6 จอครบสี่หน้า → Task 5-6 · §7 เคสเทสต์ 16 กลุ่ม → กระจายใน Task 1-6 ·
§8 ผลลัพธ์ที่ถือว่าเสร็จ → Task 7

**เคสของ spec §7 ที่ต้องชี้ให้ชัดว่าอยู่ไหน:** ข้อ 6 (ปิดพร้อมกันสองครั้ง) = Task 4
เคส "ปิดกะที่ปิดไปแล้ว" · ข้อ 9 (รับเงินหลังปิดกะ) = Task 1 เคสสุดท้าย ·
ข้อ 13 (แคชเชียร์เปิด `/admin/shifts` ไม่ได้) = ด่าน `canViewShiftHistory` ใน Task 6 Step 4

**Type consistency** — `getShiftReport()` คืน object ที่มี `shift` เป็นแถว `Shift`
ทั้งใน Task 3 และที่หน้าจอ Task 5 ใช้ `report.shift.openingFloat` · `closeShift()`
คืน `{ ok, shiftId, alreadyClosed }` เหมือนกันทั้ง Task 4 และ action ใน Task 5 ·
`ShiftSummary` รับ `shift` ที่มี `openedByStaff`/`closedByStaff`/`branch` ซึ่ง `getShift()`
ใน Task 4 `include` มาให้ครบแล้ว

**ที่จงใจไม่ทำตาม spec หนึ่งข้อ** — ไม่เพิ่ม `/admin/shifts` เข้าแถบเมนูหลังร้าน
(เหตุผลใน Global Constraints) หน้ายังอยู่ครบตามที่ spec เขียน แค่เข้าจากหน้าสรุปวันนี้แทน
