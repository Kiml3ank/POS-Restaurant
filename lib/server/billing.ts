import "server-only";

import { calculateBill, type Bill } from "@/lib/bill";
import { prisma } from "@/lib/server/db";

/**
 * รวบบิลของโต๊ะเพื่อคิดเงิน (บทที่ 10)
 *
 * ── ขอบเขตของไฟล์นี้ ────────────────────────────────────────────────────
 * ที่นี่ทำแค่ **"คิด" กับ "แสดง"** ยอดของบิลที่ยังไม่ปิด ไม่เขียนอะไรลง DB เลย
 * การรับเงินและปิดบิล (SERVED → PAID + snapshot อัตราลง `Order`) อยู่ที่
 * `lib/server/payment.ts` (บทที่ 11) ส่วนเลขที่ใบกำกับภาษีที่ต้องเดินต่อเนื่อง
 * เป็นงานของบทที่ 12
 *
 * **ยอดที่ฟังก์ชันนี้คืนออกไปห้ามถูกนำไปบันทึกเป็นยอดที่ลูกค้าจ่าย** — ตอนปิดบิล
 * `takePayment()` คิดใหม่เองในtransaction เสมอ เพราะยอดอาจเปลี่ยนระหว่างที่
 * แคชเชียร์กำลังอ่านให้ลูกค้าฟัง (ลูกค้ากดสั่งเพิ่มจากมือถือได้ตลอดเวลา)
 *
 * ── หนึ่งบิล = หนึ่ง "รอบโต๊ะ" ไม่ใช่หนึ่ง Order ───────────────────────
 * ลูกค้าโต๊ะเดียวสั่งเป็นรอบ ๆ ได้หลายใบ (สั่งข้าว → สั่งของหวานทีหลัง)
 * แต่ตอนคิดเงินคือใบเดียว จึงรวม subtotal ของทุกออร์เดอร์ที่ยังมีชีวิตในรอบนั้น
 * **แล้วค่อยคิดเซอร์วิสชาร์จกับ VAT ครั้งเดียวจากยอดรวม** ไม่ใช่คิดทีละใบแล้วบวกกัน
 *
 * เหตุผลไม่ใช่แค่ความสวยงาม — คิดทีละใบแล้วบวกจะปัดเศษหลายรอบ:
 *   สามใบ ใบละ 33.33 → เซอร์วิส 10% = 3.33 × 3 = 9.99
 *   รวมก่อนคิด 99.99 → เซอร์วิส 10% = 10.00
 * ต่างกันหนึ่งสตางค์ต่อบิล ซึ่งพอสิ้นเดือนคือยอดที่กระทบงบจริงและอธิบายไม่ได้
 *
 * ── อัตราที่ใช้มาจาก Branch (ค่าปัจจุบัน) ไม่ใช่ snapshot ─────────────
 * เพราะบิลยังไม่ปิด ยอดที่แสดงคือ "ถ้าคิดเงินตอนนี้จะเป็นเท่าไหร่"
 * ตอนปิดบิลจริง `takePayment()` คัดลอกอัตราลงคอลัมน์ `serviceChargeBp` /
 * `vatRateBp` / `pricesIncludeVat` ของทั้ง `Payment` และ `Order` ทุกใบแล้ว
 * (บทที่ 11) ใบเสร็จย้อนหลังต้องอ่านจากตรงนั้นเท่านั้น ห้ามกลับมาอ่าน Branch อีก
 * (ร้านขึ้นเซอร์วิสชาร์จแล้ว บิลเมื่อวานต้องไม่เปลี่ยนตาม)
 */

/**
 * สถานะออร์เดอร์ที่ถือว่า "ต้องจ่าย" — ยังไม่จ่ายและยังไม่ถูกยกเลิก
 *
 * export เพราะ lib/server/payment.ts (บทที่ 11) ต้องเลือกบิลชุดเดียวกันเป๊ะ ๆ
 * ตอนปิดบิล ถ้าสองที่นิยาม "บิลที่ต้องจ่าย" ไม่ตรงกันเมื่อไหร่ จะมีบิลที่ถูกคิดเงิน
 * แต่ไม่ถูกปิด (หรือกลับกัน) แล้วรอบโต๊ะจะปิดไปทั้งที่ยังมีบิลค้าง
 */
export const BILLABLE_ORDER_STATUSES = ["PLACED", "IN_PROGRESS", "READY", "SERVED"] as const;

export type TableBill = NonNullable<Awaited<ReturnType<typeof getTableBill>>>;
export type TableBillLine = TableBill["lines"][number];

/**
 * บิลของโต๊ะหนึ่งโต๊ะ ณ ตอนนี้ — คืน null เมื่อไม่พบโต๊ะในสาขาของพนักงาน
 *
 * คืน `session = null` เมื่อโต๊ะยังไม่ได้เปิด (ไม่มีอะไรให้คิดเงิน) ซึ่งต่างจาก
 * "เปิดแล้วแต่ยังไม่ได้สั่งอะไร" — สองกรณีนี้หน้าจอต้องพูดคนละอย่าง
 */
export async function getTableBill(branchId: string, tableId: string) {
  const table = await prisma.restaurantTable.findFirst({
    where: { id: tableId, branchId, isActive: true },
    include: { branch: true },
  });

  if (!table) {
    return null;
  }

  const session = await prisma.tableSession.findFirst({
    where: { tableId: table.id, status: "OPEN", expiresAt: { gt: new Date() } },
    orderBy: { openedAt: "desc" },
  });

  const orders = session
    ? await prisma.order.findMany({
        where: {
          tableSessionId: session.id,
          status: { in: [...BILLABLE_ORDER_STATUSES] },
        },
        orderBy: { placedAt: "asc" },
        include: {
          items: {
            // รายการที่ถูกยกเลิกไม่ต้องขึ้นบิลเลย ลูกค้าไม่ได้กินและไม่ต้องจ่าย
            // (ประวัติการยกเลิกอยู่ใน AuditLog แล้ว ไม่ต้องเอามาโชว์บนบิลลูกค้า)
            where: { status: { not: "CANCELLED" } },
            orderBy: { createdAt: "asc" },
            include: { modifiers: { orderBy: { nameSnapshot: "asc" } } },
          },
        },
      })
    : [];

  /**
   * รวมทุกบรรทัดจากทุกออร์เดอร์ให้เป็นรายการเดียว
   *
   * ตั้งใจ **ไม่รวมบรรทัดที่เป็นเมนูเดียวกันจากคนละออร์เดอร์เข้าด้วยกัน**
   * เพราะลูกค้าอ่านบิลแล้วต้องเทียบกับที่ตัวเองสั่งได้ทีละรอบ ถ้าไปยุบรวมกัน
   * "กะเพรา 2 + กะเพรา 1" กลายเป็น "กะเพรา 3" ลูกค้าที่จำได้ว่าสั่งสองรอบ
   * จะเริ่มไม่แน่ใจว่าโดนคิดเกินหรือเปล่า
   */
  const lines = orders.flatMap((order) =>
    order.items.map((item) => ({
      id: item.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      name: item.nameSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPriceSnapshot + item.modifierTotal,
      lineTotal: item.lineTotal,
      status: item.status,
      note: item.note,
      modifiers: item.modifiers.map((modifier) => modifier.nameSnapshot),
    })),
  );

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);

  const bill: Bill = calculateBill({
    subtotal,
    rates: {
      serviceChargeBp: table.branch.serviceChargeBp,
      vatRateBp: table.branch.vatRateBp,
      pricesIncludeVat: table.branch.pricesIncludeVat,
    },
  });

  /**
   * ของที่ครัวยังทำไม่เสร็จ / ยังไม่ได้ยกไปเสิร์ฟ
   *
   * ไม่ได้ห้ามคิดเงิน (ลูกค้าขอจ่ายก่อนแล้วรอรับของได้ และบางร้านเก็บเงินก่อนเสมอ)
   * แต่หน้าจอต้องเตือน เพราะการปิดบิลทั้งที่ของยังไม่ออกคือจุดที่ลูกค้าลุกไป
   * แล้วอาหารถูกทิ้ง — พนักงานต้องเห็นก่อนกด ไม่ใช่รู้ทีหลัง
   */
  const unservedCount = lines
    .filter((line) => line.status !== "SERVED")
    .reduce((sum, line) => sum + line.quantity, 0);

  return {
    table,
    branch: table.branch,
    session,
    orders,
    lines,
    bill,
    unservedCount,
    /** true = ไม่มีอะไรให้คิดเงิน (เปิดโต๊ะแล้วแต่ยังไม่ได้สั่ง หรือยกเลิกหมด) */
    isEmpty: lines.length === 0,
  };
}
