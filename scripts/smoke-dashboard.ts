import "dotenv/config";

import { canViewDashboard } from "@/lib/rbac";
import { getTableBill } from "@/lib/server/billing";
import { branchTodayRangeUtc, startOfBranchDayUtc } from "@/lib/server/branch-time";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { getDashboard } from "@/lib/server/dashboard";
import { prisma } from "@/lib/server/db";
import { takePayment } from "@/lib/server/payment";
import { openSalePointSession, openTableByStaff } from "@/lib/server/pos";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * Smoke test ของหน้าแรกหลังร้าน (spec §1)
 *
 *     npm run smoke:dashboard
 *
 * ── สิ่งที่ต้องพิสูจน์ ────────────────────────────────────────────────────
 *   1. **ยอดขายวันนี้ = ผลรวมของ `Payment` ที่จ่ายวันนี้เท่านั้น** — บิลเมื่อวาน
 *      ต้องไม่ปน ไม่งั้นตัวเลขบนจอโตขึ้นเรื่อย ๆ จนไม่มีความหมาย
 *   2. **นับจาก `Payment` ไม่ใช่ผลรวมของ `Order`** — ยอดใน Order เป็นแค่ส่วนแบ่ง
 *      ที่กระจายไว้ทำรายงาน ไม่ใช่เงินที่อยู่ในลิ้นชักจริง (กฎตั้งแต่บทที่ 11)
 *   3. **แคชเชียร์/ครัวดูไม่ได้** — หน้านี้บอกยอดขายทั้งสาขาในจอเดียว
 *
 * ใช้โต๊ะ B1 กับเคาน์เตอร์ แล้วล้างทุกอย่างที่สร้างตอนจบ
 */

const TABLE_CODE = "b1t6nw";

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

async function clearSalePoint(tableId: string) {
  const sessions = await prisma.tableSession.findMany({ where: { tableId } });

  for (const session of sessions) {
    await prisma.order.deleteMany({ where: { tableSessionId: session.id } });
    const payments = await prisma.payment.findMany({ where: { tableSessionId: session.id } });
    await prisma.receipt.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { tableSessionId: session.id } });
  }

  await prisma.tableSession.deleteMany({ where: { tableId } });
  await prisma.restaurantTable.update({ where: { id: tableId }, data: { status: "AVAILABLE" } });
}

async function main() {
  const owner = (await prisma.staff.findFirstOrThrow({
    where: { code: "001" },
    include: { branch: true },
  })) as CurrentStaff;
  const branchId = owner.branchId;
  const branch = owner.branch;

  const table = await prisma.restaurantTable.findFirstOrThrow({
    where: { tableCode: TABLE_CODE },
  });
  const counter = await prisma.restaurantTable.findFirstOrThrow({ where: { id: "seed-counter-1" } });

  await clearSalePoint(table.id);
  await clearSalePoint(counter.id);

  try {
    console.log("── 1. สิทธิ์ ─────────────────────────────────────────────────────\n");

    check("เจ้าของร้านดูได้", canViewDashboard("OWNER") === true);
    check("ผู้จัดการดูได้", canViewDashboard("MANAGER") === true);
    check("แคชเชียร์ดูไม่ได้ (เห็นยอดขายทั้งสาขาในจอเดียว)", canViewDashboard("CASHIER") === false);
    check("ครัวดูไม่ได้", canViewDashboard("KITCHEN") === false);

    const cashier = (await prisma.staff.findFirstOrThrow({
      where: { code: "002" },
      include: { branch: true },
    })) as CurrentStaff;
    const refused = await getDashboard(cashier);
    check("getDashboard() ปฏิเสธแคชเชียร์", refused.ok === false, refused.ok ? "" : refused.error);

    console.log("\n── 2. ช่วง 'วันนี้' ของสาขา ──────────────────────────────────────\n");

    const todayRange = branchTodayRangeUtc(branch.timezone);
    check("วันของสาขาอยู่ในรูปแบบ YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(todayRange.ymd), todayRange.ymd);
    check(
      "ช่วงวันนี้ยาว 24 ชั่วโมงพอดี",
      todayRange.lt.getTime() - todayRange.gte.getTime() === 24 * 60 * 60 * 1000,
    );
    check("ตอนนี้อยู่ในช่วงวันนี้", Date.now() >= todayRange.gte.getTime() && Date.now() < todayRange.lt.getTime());
    check(
      "เที่ยงคืนของสาขา +07:00 ไม่ใช่เที่ยงคืน UTC",
      branch.timezone !== "Asia/Bangkok" ||
        startOfBranchDayUtc("2026-08-24", "Asia/Bangkok")?.toISOString() === "2026-08-23T17:00:00.000Z",
      String(startOfBranchDayUtc("2026-08-24", "Asia/Bangkok")?.toISOString()),
    );

    console.log("\n── 3. ยอดขายวันนี้ ───────────────────────────────────────────────\n");

    const empty = await getDashboard(owner);
    const baseline = empty.ok ? empty.data.sales.total : 0;
    const baselineBills = empty.ok ? empty.data.sales.billCount : 0;

    // บิลที่ 1 — โต๊ะนั่ง จ่ายเงินสด
    const opened = await openTableByStaff(owner, table.id, 2);
    if (!opened.ok) throw new Error(opened.error);
    const addOne = await addToCart({
      tableSessionId: opened.session.id,
      branchId,
      tableId: table.id,
      timezone: branch.timezone,
      menuItemId: "seed-item-krapao",
      quantity: 2,
      modifierIds: ["seed-mod-size-regular", "seed-mod-spice-mild"],
      note: null,
      channel: "POS",
    });
    if (!addOne.ok) throw new Error(addOne.error);
    await placeOrder(opened.session.id);

    const bill1 = await getTableBill(branchId, table.id);
    const paid1 = await takePayment(owner, table.id, {
      method: "CASH",
      receivedAmount: bill1 && !bill1.isEmpty ? bill1.bill.grandTotal : 0,
    });
    if (!paid1.ok) throw new Error(paid1.error);
    const payment1 = await prisma.payment.findUniqueOrThrow({ where: { id: paid1.paymentId } });

    // บิลที่ 2 — ซื้อกลับ จ่าย QR
    const queue = await openSalePointSession(owner, counter.id);
    if (!queue.ok) throw new Error(queue.error);
    await addToCart({
      tableSessionId: queue.session.id,
      branchId,
      tableId: counter.id,
      timezone: branch.timezone,
      menuItemId: "seed-item-krapao",
      quantity: 1,
      modifierIds: ["seed-mod-size-regular", "seed-mod-spice-mild"],
      note: null,
      channel: "POS",
    });
    await placeOrder(queue.session.id);

    const bill2 = await getTableBill(branchId, counter.id);
    const paid2 = await takePayment(owner, counter.id, {
      method: "QR",
      sessionId: queue.session.id,
      receivedAmount: bill2 && !bill2.isEmpty ? bill2.bill.grandTotal : 0,
    });
    if (!paid2.ok) throw new Error(paid2.error);
    const payment2 = await prisma.payment.findUniqueOrThrow({ where: { id: paid2.paymentId } });

    const after = await getDashboard(owner);
    if (!after.ok) throw new Error(after.error);
    const data = after.data;

    check(
      "ยอดขายเพิ่มขึ้นเท่ากับสองบิลที่เพิ่งปิดพอดี",
      data.sales.total === baseline + payment1.grandTotal + payment2.grandTotal,
      `${baseline} + ${payment1.grandTotal} + ${payment2.grandTotal} = ${data.sales.total}`,
    );
    check("จำนวนบิลเพิ่มขึ้นสองใบ", data.sales.billCount === baselineBills + 2, String(data.sales.billCount));
    check(
      "ยอดเฉลี่ยต่อบิลเป็นจำนวนเต็ม ไม่ใช่ทศนิยม",
      Number.isInteger(data.sales.average),
      String(data.sales.average),
    );
    check("สกุลเงินติดมากับข้อมูล (จอห้ามเดาเอง)", data.currency === branch.currency, data.currency);

    const cash = data.sales.byMethod.find((row) => row.method === "CASH");
    const qr = data.sales.byMethod.find((row) => row.method === "QR");
    check("แยกยอดตามวิธีจ่ายได้", (cash?.amount ?? 0) >= payment1.grandTotal && (qr?.amount ?? 0) >= payment2.grandTotal,
      `CASH ${cash?.amount} · QR ${qr?.amount}`);
    check(
      "ผลรวมของทุกวิธีจ่าย = ยอดขายรวม (ไม่มีบิลไหนตกหล่นหรือนับซ้ำ)",
      data.sales.byMethod.reduce((sum, row) => sum + row.amount, 0) === data.sales.total,
    );

    const dineIn = data.sales.byChannel.find((row) => row.kind === "DINE_IN");
    const takeaway = data.sales.byChannel.find((row) => row.kind === "COUNTER");
    check(
      "แยกยอดตามช่องทางขายได้ (นั่งที่ร้าน / ซื้อกลับ)",
      (dineIn?.count ?? 0) >= 1 && (takeaway?.count ?? 0) >= 1,
      `นั่ง ${dineIn?.count} ใบ · ซื้อกลับ ${takeaway?.count} ใบ`,
    );
    check(
      "ผลรวมของทุกช่องทาง = ยอดขายรวม",
      data.sales.byChannel.reduce((sum, row) => sum + row.amount, 0) === data.sales.total,
    );

    /**
     * เคสที่จับบั๊กได้จริงถ้ามีใครเปลี่ยนไปบวก `Order.grandTotal` แทน:
     * ยอดใน Order เป็นส่วนแบ่งที่กระจายไว้ ซึ่งรวมกันแล้ว "ควร" เท่ากับ Payment
     * แต่ไม่มีอะไรรับประกันเมื่อบิลถูกแยก/รวมในอนาคต — ที่มาของตัวเลขต้องเป็น Payment
     */
    const orderSum = await prisma.order.aggregate({
      where: { branchId, payment: { paidAt: { gte: todayRange.gte, lt: todayRange.lt } } },
      _sum: { grandTotal: true },
    });
    check(
      "ยอดจาก Payment ตรงกับผลรวมส่วนแบ่งใน Order ของวันเดียวกัน",
      (orderSum._sum.grandTotal ?? 0) === data.sales.total,
      `${orderSum._sum.grandTotal} vs ${data.sales.total}`,
    );

    console.log("\n── 4. บิลเมื่อวานต้องไม่ปนมา ────────────────────────────────────\n");

    await prisma.payment.update({
      where: { id: payment1.id },
      data: { paidAt: new Date(todayRange.gte.getTime() - 60 * 60 * 1000) },
    });

    const afterBackdate = await getDashboard(owner);
    if (!afterBackdate.ok) throw new Error(afterBackdate.error);

    check(
      "ย้ายบิลไปเมื่อวานแล้วยอดวันนี้ลดลงเท่ากับบิลนั้นพอดี",
      afterBackdate.data.sales.total === data.sales.total - payment1.grandTotal,
      `${data.sales.total} → ${afterBackdate.data.sales.total}`,
    );
    check(
      "จำนวนบิลวันนี้ลดลงหนึ่งใบ",
      afterBackdate.data.sales.billCount === data.sales.billCount - 1,
    );

    await prisma.payment.update({ where: { id: payment1.id }, data: { paidAt: payment1.paidAt } });

    console.log("\n── 5. สถานะหน้าร้านตอนนี้ ────────────────────────────────────────\n");

    const openTable = await openTableByStaff(owner, table.id, 4);
    if (!openTable.ok) throw new Error(openTable.error);
    await addToCart({
      tableSessionId: openTable.session.id,
      branchId,
      tableId: table.id,
      timezone: branch.timezone,
      menuItemId: "seed-item-krapao",
      quantity: 3,
      modifierIds: ["seed-mod-size-regular", "seed-mod-spice-mild"],
      note: null,
      channel: "POS",
    });
    await placeOrder(openTable.session.id);

    const live = await getDashboard(owner);
    if (!live.ok) throw new Error(live.error);

    check("นับบิลที่เปิดอยู่ตอนนี้", live.data.now.openBills >= 1, `${live.data.now.openBills} ใบ`);
    check("แยกโต๊ะนั่งกับซื้อกลับที่เปิดอยู่", live.data.now.openDineIn >= 1, `นั่ง ${live.data.now.openDineIn} · ซื้อกลับ ${live.data.now.openTakeaway}`);
    check(
      "บอกยอดค่าอาหารที่ยังไม่ได้เก็บ",
      live.data.now.openSubtotal > 0,
      String(live.data.now.openSubtotal),
    );
    check(
      "นับของที่ครัวยังทำไม่เสร็จเป็นจำนวนชิ้น ไม่ใช่จำนวนบิล",
      live.data.now.kitchenPending >= 3,
      `${live.data.now.kitchenPending} ชิ้น`,
    );
    check("นับเครื่องที่ล็อกอินอยู่", typeof live.data.now.activeStaffSessions === "number");

    console.log("\n── 6. เมนูขายดีวันนี้ ────────────────────────────────────────────\n");

    check("มีรายการเมนูขายดี", live.data.topItems.length > 0, `${live.data.topItems.length} รายการ`);
    check(
      "เรียงจากขายดีที่สุดลงมา",
      live.data.topItems.every(
        (item, index) => index === 0 || item.quantity <= live.data.topItems[index - 1].quantity,
      ),
      live.data.topItems.map((item) => `${item.name} ${item.quantity}`).join(" · "),
    );
    check(
      "นับของที่ส่งเข้าครัวแล้ว ไม่ใช่เฉพาะบิลที่จ่ายแล้ว (ไม่งั้นช่วงเย็นจะดูเหมือนขายไม่ออก)",
      (live.data.topItems.find((item) => item.name.includes("Kra Pao"))?.quantity ?? 0) >= 6,
      String(live.data.topItems.find((item) => item.name.includes("Kra Pao"))?.quantity),
    );

    console.log("\n── 7. เหตุการณ์ที่ต้องจับตา ─────────────────────────────────────\n");

    const before = live.data.sensitiveEvents;
    await prisma.auditLog.create({
      data: {
        branchId,
        staffId: owner.id,
        action: "order_item.cancel",
        entityType: "order_item",
        entityId: "smoke-dashboard",
        metadata: { reason: "ทดสอบ" },
      },
    });

    const afterEvent = await getDashboard(owner);
    check(
      "นับเฉพาะ action ที่อยู่ในรายการต้องจับตา",
      afterEvent.ok === true && afterEvent.data.sensitiveEvents === before + 1,
      afterEvent.ok ? `${before} → ${afterEvent.data.sensitiveEvents}` : "",
    );

    await prisma.auditLog.create({
      data: {
        branchId,
        staffId: owner.id,
        action: "receipt.print",
        entityType: "receipt",
        entityId: "smoke-dashboard",
        metadata: {},
      },
    });

    const afterNormal = await getDashboard(owner);
    check(
      "action ธรรมดา (พิมพ์ใบเสร็จ) ไม่ถูกนับรวม",
      afterNormal.ok === true && afterNormal.data.sensitiveEvents === before + 1,
      afterNormal.ok ? String(afterNormal.data.sensitiveEvents) : "",
    );
  } finally {
    console.log("\n── ล้างข้อมูลที่สร้างระหว่างทดสอบ ───────────────────────────────\n");

    await prisma.auditLog.deleteMany({ where: { entityId: "smoke-dashboard" } });
    await clearSalePoint(table.id);
    await clearSalePoint(counter.id);

    check(
      "ล้างรอบขายที่สร้างไว้หมดแล้ว",
      (await prisma.tableSession.count({ where: { tableId: { in: [table.id, counter.id] } } })) === 0,
    );

    console.log(`\nรวม ${passed + failed} เคส — PASS ${passed} · FAIL ${failed}`);
  }
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
