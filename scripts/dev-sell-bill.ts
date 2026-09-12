import "dotenv/config";

import { getSessionBill } from "@/lib/server/billing";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import { takePayment } from "@/lib/server/payment";
import { openTableByStaff } from "@/lib/server/pos";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * ขายบิลปลอมใส่ฐาน dev เพื่อให้หน้าที่ต้องมีข้อมูลจริง "มีของ" ก่อนวัดจอ
 *
 *     npm run dev:sell-bill            # 4 บิล วันนี้
 *     npm run dev:sell-bill 10         # 10 บิล
 *     npm run dev:sell-bill 6 3        # 6 บิล กระจายย้อนหลัง 3 วัน
 *
 * ⚠ **ฐาน dev เท่านั้น** — เขียนบิลจริงลงตารางจริงทุกอย่าง (ออกใบเสร็จด้วย)
 * ล้างด้วย `npm run dev:reset-table DEV-SALES`
 *
 * มีไว้เพราะ `audit:screens` ต้องวัดหน้าที่มีข้อมูลจริง ไม่งั้นจะได้ FAIL ที่ไม่ใช่
 * บั๊กจอ (หน้าจะขึ้นว่า "ยังไม่มีบิล" แล้ว `mustSee` หาไม่เจอ) — และ smoke ทุกชุด
 * ล้างของตัวเองทิ้งตอนจบเสมอ จึงไม่เหลืออะไรให้วัด
 */

const TABLE_NAME = "DEV-SALES";
const ITEM = "seed-item-krapao";
const OPTIONS = ["seed-mod-spice-mild", "seed-mod-size-regular"];

async function main() {
  const bills = Number(process.argv[2] ?? "4");
  const spreadDays = Number(process.argv[3] ?? "0");

  if (!Number.isInteger(bills) || bills < 1 || bills > 100) {
    throw new Error("จำนวนบิลต้องเป็น 1-100");
  }

  const staff: CurrentStaff = await prisma.staff.findUniqueOrThrow({
    where: { id: "seed-staff-cashier" },
    include: { branch: true },
  });

  const table =
    (await prisma.restaurantTable.findFirst({
      where: { branchId: staff.branchId, name: TABLE_NAME },
    })) ??
    (await prisma.restaurantTable.create({
      data: {
        branchId: staff.branchId,
        name: TABLE_NAME,
        tableCode: `dev-sales-${Date.now()}`,
        seats: 4,
        kind: "DINE_IN",
        sortOrder: 990,
      },
    }));

  let total = 0;

  for (let i = 0; i < bills; i++) {
    const opened = await openTableByStaff(staff, table.id, 2);

    if (!opened.ok) {
      throw new Error(`เปิดโต๊ะไม่สำเร็จ: ${opened.errorKey}`);
    }

    const session = await prisma.tableSession.findFirstOrThrow({
      where: { tableId: table.id, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    await addToCart({
      tableSessionId: session.id,
      branchId: staff.branchId,
      tableId: table.id,
      timezone: staff.branch.timezone,
      menuItemId: ITEM,
      quantity: (i % 3) + 1,
      modifierIds: OPTIONS,
      note: null,
    });
    await placeOrder(session.id, { placedByStaffId: staff.id });

    const bill = await getSessionBill(staff.branchId, session.id);
    const due = bill!.bill.grandTotal;

    const paid = await takePayment(staff, table.id, {
      // สลับช่องทางเพื่อให้ตารางแยกช่องทางมีมากกว่าหนึ่งแถว
      method: i % 3 === 0 ? "QR" : "CASH",
      receivedAmount: i % 3 === 0 ? null : due,
      expectedTotal: due,
      sessionId: session.id,
    });

    if (!paid.ok) {
      throw new Error(`รับเงินไม่สำเร็จ: ${paid.errorKey}`);
    }

    if (spreadDays > 0) {
      // กระจายย้อนหลังเพื่อให้กราฟ "ตามวัน" มีมากกว่าหนึ่งแท่ง
      const daysBack = i % (spreadDays + 1);
      const hour = 9 + (i % 12);
      const at = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
      at.setHours(hour, (i * 7) % 60, 0, 0);
      await prisma.payment.update({ where: { id: paid.paymentId }, data: { paidAt: at } });
    }

    total += due;
  }

  console.log(`ขายแล้ว ${bills} บิล รวม ${total} (หน่วยย่อยของ ${staff.branch.currency})`);
  console.log(`โต๊ะ ${TABLE_NAME} · ล้างด้วย: npm run dev:reset-table ${TABLE_NAME}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
