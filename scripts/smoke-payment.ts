import "dotenv/config";

import { calculateBill, distributeByWeight } from "@/lib/bill";
import type { Currency } from "@/lib/generated/prisma/enums";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { canTakePayment } from "@/lib/rbac";
import type { RealtimeEvent } from "@/lib/realtime-events";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { getTableBill } from "@/lib/server/billing";
import { prisma } from "@/lib/server/db";
import { getPayment, takePayment } from "@/lib/server/payment";
import { stopRealtime, subscribeToBranch } from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { openOrJoinTableSession } from "@/lib/server/table-session";

/**
 * Smoke test ของการรับเงิน (บทที่ 11 — โหมดสาธิต)
 *
 *     npm run smoke:payment
 *
 * ใช้โต๊ะ **A3** ร่วมกับ smoke:kds ได้เพราะสคริปต์รันทีละตัวและล้างของตัวเองทุกครั้ง
 * (A1 = smoke:order · A2/A3 = smoke:kds · B1/B2 = smoke:pos/smoke:bill)
 *
 * ท้ายไฟล์มีเคสที่ **สลับสาขาเป็นสกุลเงินเวียดนามชั่วคราว** เพื่อพิสูจน์ว่าเส้นทาง
 * รับเงินไม่ได้ผูกกับ "สตางค์" ที่ไหนเลย — ค่าเดิมของสาขาถูกคืนใน finally เสมอ
 */

const TABLE_ID = "seed-table-a3";

const KRAPAO = "seed-item-krapao";
const WATER = "seed-item-water";
const KRAPAO_OPTIONS = ["seed-mod-spice-mild", "seed-mod-size-regular"];

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function loadStaff(id: string): Promise<CurrentStaff> {
  return prisma.staff.findUniqueOrThrow({ where: { id }, include: { branch: true } });
}

/**
 * ล้างโต๊ะให้กลับไปว่าง — ลำดับการลบสำคัญมาก
 * Order → Payment เป็น Restrict และ Payment → TableSession ก็ Restrict
 * จึงต้องลบ ออร์เดอร์ → การรับเงิน → รอบโต๊ะ ตามลำดับนี้เท่านั้น
 */
async function resetTable(tableId: string) {
  const sessions = await prisma.tableSession.findMany({
    where: { tableId },
    select: { id: true, orders: { select: { id: true } } },
  });

  const sessionIds = sessions.map((session) => session.id);
  const paymentIds = (
    await prisma.payment.findMany({
      where: { tableSessionId: { in: sessionIds } },
      select: { id: true },
    })
  ).map((payment) => payment.id);

  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...sessionIds, ...paymentIds] } } });
  await prisma.order.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.receipt.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.restaurantTable.update({ where: { id: tableId }, data: { status: "AVAILABLE" } });
}

/** เปิดโต๊ะแล้วสั่งของสองรอบ เพื่อให้ได้ "หนึ่งรอบโต๊ะ หลายบิล" ซึ่งเป็นเคสจริงของบทนี้ */
async function seedTwoOrders(branchId: string, timezone: string) {
  const session = await openOrJoinTableSession({ tableId: TABLE_ID, branchId, pax: 3 });

  const line = {
    tableSessionId: session.id,
    branchId,
    tableId: TABLE_ID,
    timezone,
    note: null,
  };

  await addToCart({ ...line, menuItemId: KRAPAO, quantity: 2, modifierIds: KRAPAO_OPTIONS });
  await placeOrder(session.id);

  await addToCart({ ...line, menuItemId: WATER, quantity: 3, modifierIds: [] });
  await placeOrder(session.id);

  return session;
}

async function main() {
  const branch = await prisma.branch.findFirstOrThrow();
  const owner = await loadStaff("seed-staff-owner");
  const cashier = await loadStaff("seed-staff-cashier");
  const server = await loadStaff("seed-staff-server");

  // ── 1. distributeByWeight: ผลรวมต้องเท่าเดิมเป๊ะทุกกรณี ────────────────
  const equalSplit = distributeByWeight(100, [1, 1, 1]);
  check(
    "แบ่ง 100 ให้ 3 ส่วนเท่ากัน = ผลรวมยังเป็น 100",
    equalSplit.reduce((sum, value) => sum + value, 0) === 100,
    equalSplit.join("+"),
  );
  check("เศษถูกแจกให้ใบแรกก่อน (ผลลัพธ์คงที่)", equalSplit.join(",") === "34,33,33");

  const weighted = distributeByWeight(1_177, [3_333, 3_333, 3_334]);
  check(
    "แบ่งตามน้ำหนักที่ไม่ลงตัว ผลรวมยังเท่าเดิม",
    weighted.reduce((sum, value) => sum + value, 0) === 1_177,
    weighted.join("+"),
  );
  check(
    "น้ำหนักมากกว่าต้องไม่ได้ส่วนแบ่งน้อยกว่า",
    weighted[2] >= weighted[0] && weighted[2] >= weighted[1],
    weighted.join(","),
  );

  check("ยอด 0 แบ่งแล้วได้ 0 ทุกช่อง", distributeByWeight(0, [5, 7]).join(",") === "0,0");
  check("ไม่มีช่องให้แบ่ง = คืนอาเรย์ว่าง", distributeByWeight(500, []).length === 0);

  const zeroWeights = distributeByWeight(7, [0, 0, 0]);
  check(
    "น้ำหนักเป็น 0 ทั้งหมด → แบ่งเท่า ๆ กันแล้วผลรวมยังเท่าเดิม",
    zeroWeights.reduce((sum, value) => sum + value, 0) === 7,
    zeroWeights.join("+"),
  );

  let invariantHolds = true;
  for (let total = 0; total < 200; total += 7) {
    for (const weights of [[1], [1, 2], [10, 1, 1], [999, 1], [0, 5, 5], [3, 3, 3, 3]]) {
      const parts = distributeByWeight(total, weights);
      if (parts.reduce((sum, value) => sum + value, 0) !== total) {
        invariantHolds = false;
      }
      if (parts.some((value) => !Number.isInteger(value) || value < 0)) {
        invariantHolds = false;
      }
    }
  }
  check("invariant: sum(ผลลัพธ์) === total และเป็นจำนวนเต็มไม่ติดลบ ทุกชุดที่ลอง", invariantHolds);

  // ── 2. อ่านจำนวนเงินที่พนักงานพิมพ์ ──────────────────────────────────
  check("THB '1000' = 100000 สตางค์", parseMoneyInput("1000", "THB") === 100_000);
  check("THB '19.99' = 1999 สตางค์ (ไม่เพี้ยนแบบ float)", parseMoneyInput("19.99", "THB") === 1_999);
  check("THB '1,200.5' = 120050 สตางค์", parseMoneyInput("1,200.5", "THB") === 120_050);
  check("VND '250.000' = 250000 ดอง", parseMoneyInput("250.000", "VND") === 250_000);
  check("LAK '50,000' = 50000 กีบ", parseMoneyInput("50,000", "LAK") === 50_000);
  check("ช่องว่าง = null", parseMoneyInput("   ", "THB") === null);
  check("ตัวอักษรปนมา = null", parseMoneyInput("1000บาท", "THB") === null);

  // ── 3. RBAC ──────────────────────────────────────────────────────────
  check("เจ้าของรับเงินได้", canTakePayment("OWNER"));
  check("ผู้จัดการรับเงินได้", canTakePayment("MANAGER"));
  check("แคชเชียร์รับเงินได้", canTakePayment("CASHIER"));
  check("พนักงานเสิร์ฟรับเงินไม่ได้", !canTakePayment("SERVER"));
  check("ครัวรับเงินไม่ได้", !canTakePayment("KITCHEN"));

  // ── 4. เส้นทางจริงกับ DB: เงินสดพอดี ─────────────────────────────────
  await resetTable(TABLE_ID);

  const emptySession = await openOrJoinTableSession({
    tableId: TABLE_ID,
    branchId: branch.id,
    pax: 1,
  });
  const emptyResult = await takePayment(cashier, TABLE_ID, { method: "CASH", receivedAmount: 0 });
  check(
    "บิลว่าง (เปิดโต๊ะแล้วยังไม่ได้สั่ง) จ่ายไม่ได้",
    !emptyResult.ok,
    emptyResult.ok ? "" : emptyResult.errorKey,
  );

  const stillOpen = await prisma.tableSession.findUniqueOrThrow({ where: { id: emptySession.id } });
  check("บิลว่างจ่ายไม่ผ่าน → รอบโต๊ะต้องไม่ถูกปิดทิ้ง (rollback ครบ)", stillOpen.status === "OPEN");

  await resetTable(TABLE_ID);
  const session = await seedTwoOrders(branch.id, branch.timezone);

  const detail = await getTableBill(branch.id, TABLE_ID);
  const expected = detail!.bill;

  check("ตั้งต้นได้ 2 บิลในรอบเดียว", detail!.orders.length === 2, `${detail!.orders.length} ใบ`);

  const serverResult = await takePayment(server, TABLE_ID, {
    method: "CASH",
    receivedAmount: expected.grandTotal,
  });
  check(
    "พนักงานเสิร์ฟกดรับเงิน → ถูกปฏิเสธ",
    !serverResult.ok,
    serverResult.ok ? "" : serverResult.errorKey,
  );

  const shortResult = await takePayment(cashier, TABLE_ID, {
    method: "CASH",
    receivedAmount: expected.grandTotal - 1,
  });
  check("รับเงินสดมาไม่พอ → error", !shortResult.ok, shortResult.ok ? "" : shortResult.errorKey);

  const staleResult = await takePayment(cashier, TABLE_ID, {
    method: "CASH",
    receivedAmount: expected.grandTotal,
    expectedTotal: expected.grandTotal + 100,
  });
  check(
    "ยอดบนจอไม่ตรงกับยอดจริง → ไม่ยอมปิดบิล",
    !staleResult.ok,
    staleResult.ok ? "" : staleResult.errorKey,
  );

  // ตะกร้าที่ยังไม่ได้ส่งเข้าครัวต้องกันไว้ ไม่งั้นของหายไปพร้อมรอบโต๊ะ
  await addToCart({
    tableSessionId: session.id,
    branchId: branch.id,
    tableId: TABLE_ID,
    timezone: branch.timezone,
    menuItemId: WATER,
    quantity: 1,
    modifierIds: [],
    note: null,
  });
  const draftResult = await takePayment(cashier, TABLE_ID, {
    method: "CASH",
    receivedAmount: expected.grandTotal,
  });
  check(
    "มีของค้างในตะกร้าที่ยังไม่ส่งเข้าครัว → จ่ายไม่ได้",
    !draftResult.ok,
    draftResult.ok ? "" : draftResult.errorKey,
  );

  const stillOpenAfterDraft = await prisma.tableSession.findUniqueOrThrow({
    where: { id: session.id },
  });
  check("ถูกปฏิเสธเพราะตะกร้าค้าง → รอบโต๊ะยังเปิดอยู่", stillOpenAfterDraft.status === "OPEN");

  await prisma.order.deleteMany({ where: { tableSessionId: session.id, status: "DRAFT" } });

  const received = expected.grandTotal + 5_000;
  const paidResult = await takePayment(cashier, TABLE_ID, {
    method: "CASH",
    receivedAmount: received,
    expectedTotal: expected.grandTotal,
  });

  check("รับเงินสดสำเร็จ", paidResult.ok, paidResult.ok ? paidResult.paymentId : paidResult.errorKey);

  if (!paidResult.ok) {
    throw new Error("จ่ายเงินไม่สำเร็จ ทดสอบต่อไม่ได้");
  }

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paidResult.paymentId },
    include: { orders: true },
  });

  check(
    "ยอดที่บันทึกตรงกับ calculateBill() ทุกช่อง",
    payment.subtotal === expected.subtotal &&
      payment.serviceChargeAmount === expected.serviceChargeAmount &&
      payment.vatAmount === expected.vatAmount &&
      payment.netAmount === expected.netAmount &&
      payment.grandTotal === expected.grandTotal,
    formatMoney(payment.grandTotal, payment.currency),
  );
  check(
    "netAmount + vatAmount = grandTotal",
    payment.netAmount + payment.vatAmount === payment.grandTotal,
  );
  check(
    "เงินทอน = รับมา − ยอดที่ต้องจ่าย",
    payment.receivedAmount === received && payment.changeAmount === received - expected.grandTotal,
    formatMoney(payment.changeAmount ?? 0, payment.currency),
  );
  check(
    "snapshot อัตราลง Payment ครบสามค่า",
    payment.serviceChargeBp === branch.serviceChargeBp &&
      payment.vatRateBp === branch.vatRateBp &&
      payment.pricesIncludeVat === branch.pricesIncludeVat,
  );
  check("snapshot สกุลเงินลง Payment", payment.currency === branch.currency, payment.currency);
  check("บันทึกว่าใครเป็นคนรับเงิน", payment.paidByStaffId === cashier.id);

  // ── 5. การกระจายยอดลงแต่ละบิล ────────────────────────────────────────
  check("ทั้งสองบิลผูกกับการรับเงินใบเดียวกัน", payment.orders.length === 2);
  check(
    "sum(order.grandTotal) === payment.grandTotal เป๊ะ",
    payment.orders.reduce((sum, order) => sum + order.grandTotal, 0) === payment.grandTotal,
    `${payment.orders.map((order) => order.grandTotal).join("+")} vs ${payment.grandTotal}`,
  );
  check(
    "sum(order.vatAmount) === payment.vatAmount",
    payment.orders.reduce((sum, order) => sum + order.vatAmount, 0) === payment.vatAmount,
  );
  check(
    "sum(order.serviceChargeAmount) === payment.serviceChargeAmount",
    payment.orders.reduce((sum, order) => sum + order.serviceChargeAmount, 0) ===
      payment.serviceChargeAmount,
  );
  check(
    "sum(order.subtotal) === payment.subtotal",
    payment.orders.reduce((sum, order) => sum + order.subtotal, 0) === payment.subtotal,
  );
  check(
    "แต่ละบิลอ่านแล้วบวกเองได้ (ยอดในแถวสอดคล้องกันเอง)",
    payment.orders.every((order) => {
      const base = order.subtotal - order.discountAmount + order.serviceChargeAmount;
      const expectedTotal = order.pricesIncludeVat ? base : base + order.vatAmount;

      return order.grandTotal === expectedTotal;
    }),
  );
  check(
    "ทุกบิลกลายเป็น PAID พร้อม paidAt และ snapshot อัตรา",
    payment.orders.every(
      (order) =>
        order.status === "PAID" &&
        order.paidAt !== null &&
        order.serviceChargeBp === branch.serviceChargeBp &&
        order.vatRateBp === branch.vatRateBp &&
        order.pricesIncludeVat === branch.pricesIncludeVat,
    ),
  );

  // ── 6. ผลข้างเคียงที่ต้องเกิดพร้อมกันใน transaction เดียว ─────────────
  const closedSession = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
  check("รอบโต๊ะถูกปิด", closedSession.status === "CLOSED" && closedSession.closedAt !== null);

  const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: TABLE_ID } });
  check("โต๊ะกลับเป็นว่าง", table.status === "AVAILABLE");

  const audit = await prisma.auditLog.findFirst({
    where: { action: "payment.take", entityId: payment.id },
  });
  check("เขียน AuditLog ของการรับเงิน", audit !== null && audit.staffId === cashier.id);
  check(
    "AuditLog บอกว่าเป็นโหมดสาธิต",
    (audit?.metadata as { demoMode?: boolean } | null)?.demoMode === true,
  );

  const receipt = await getPayment(branch.id, payment.id);
  check("อ่านใบสรุปกลับมาได้พร้อมรายการ", (receipt?.lines.length ?? 0) === 2);
  check(
    "อ่านข้ามสาขาไม่ได้",
    (await getPayment("ไม่มีสาขานี้", payment.id)) === null,
  );

  // ── 7. กดจ่ายซ้ำ ─────────────────────────────────────────────────────
  const repeat = await takePayment(cashier, TABLE_ID, { method: "CASH", receivedAmount: 999_999 });
  check(
    "กดยืนยันซ้ำทันที → พากลับไปใบเดิม ไม่ใช่ error และไม่ใช่ใบที่สอง",
    repeat.ok && repeat.alreadyPaid && repeat.paymentId === payment.id,
    repeat.ok ? repeat.paymentId : repeat.errorKey,
  );
  check(
    "ยังมี Payment ใบเดียวในรอบนั้น",
    (await prisma.payment.count({ where: { tableSessionId: session.id } })) === 1,
  );

  /**
   * เลื่อนเวลาที่รับเงินให้เก่ากว่ากรอบ "กดซ้ำ" แล้วกดใหม่
   * — ครั้งนี้ต้องเป็น error ไม่ใช่การพากลับไปใบเดิม (หน้าที่เปิดค้างไว้นาน ๆ)
   */
  await prisma.payment.update({
    where: { id: payment.id },
    data: { paidAt: new Date(Date.now() - 10 * 60_000) },
  });

  const staleRepeat = await takePayment(cashier, TABLE_ID, {
    method: "CASH",
    receivedAmount: 999_999,
  });
  check(
    "กดจากหน้าที่ค้างไว้นานแล้ว → error ไม่ใช่ 'สำเร็จ' ของบิลเก่า",
    !staleRepeat.ok,
    staleRepeat.ok ? "" : staleRepeat.errorKey,
  );

  // ── 8. กดพร้อมกันสองเครื่อง ──────────────────────────────────────────
  await resetTable(TABLE_ID);
  const raceSession = await seedTwoOrders(branch.id, branch.timezone);
  const raceBill = (await getTableBill(branch.id, TABLE_ID))!.bill;

  const [first, second] = await Promise.all([
    takePayment(cashier, TABLE_ID, { method: "CASH", receivedAmount: raceBill.grandTotal }),
    takePayment(owner, TABLE_ID, { method: "CASH", receivedAmount: raceBill.grandTotal }),
  ]);

  check("กดพร้อมกันสองเครื่อง: ทั้งคู่ไม่ได้ error", first.ok && second.ok);
  check(
    "กดพร้อมกันสองเครื่อง: ได้ Payment ใบเดียวเท่านั้น",
    (await prisma.payment.count({ where: { tableSessionId: raceSession.id } })) === 1,
  );
  check(
    "ทั้งสองครั้งชี้ไปที่ Payment ใบเดียวกัน",
    first.ok && second.ok && first.paymentId === second.paymentId,
  );
  check(
    "ครั้งที่มาช้ากว่าถูกทำเครื่องหมายว่า 'จ่ายไปแล้ว'",
    (first.ok && first.alreadyPaid) || (second.ok && second.alreadyPaid),
  );

  // ── 9. จ่ายด้วย QR + event realtime ──────────────────────────────────
  await resetTable(TABLE_ID);
  await seedTwoOrders(branch.id, branch.timezone);

  /**
   * ต้องได้ event "payment.completed" หลังปิดบิล ไม่งั้นผังโต๊ะของเครื่องอื่น
   * จะยังขึ้นว่าโต๊ะนี้ไม่ว่างจนกว่าจะมีคนกดโหลดหน้าใหม่เอง
   */
  const events: RealtimeEvent[] = [];
  const unsubscribe = subscribeToBranch(branch.id, (event) => events.push(event));

  const qrResult = await takePayment(cashier, TABLE_ID, { method: "QR" });

  unsubscribe();

  const paidEvent = events.find((event) => event.type === "payment.completed");
  check("ยิง event payment.completed หลังปิดบิล", paidEvent !== undefined);
  check("event ผูกกับโต๊ะที่จ่าย (ลูกค้าโต๊ะอื่นไม่ได้รับ)", paidEvent?.tableId === TABLE_ID);
  check("จ่ายด้วย QR สำเร็จ", qrResult.ok, qrResult.ok ? "" : qrResult.errorKey);

  if (qrResult.ok) {
    const qrPayment = await prisma.payment.findUniqueOrThrow({ where: { id: qrResult.paymentId } });
    check("QR ไม่มีเงินรับมา/เงินทอน", qrPayment.receivedAmount === null && qrPayment.changeAmount === null);
    check("บันทึกวิธีจ่ายเป็น QR", qrPayment.method === "QR");
  }

  const cardResult = await takePayment(cashier, TABLE_ID, { method: "CARD" });
  check("บัตรยังไม่เปิดใช้ในก้อนนี้", !cardResult.ok, cardResult.ok ? "" : cardResult.errorKey);

  // ── 10. สกุลเงินอื่น (เวียดนาม ไม่มีทศนิยม) ──────────────────────────
  await runVietnamCase(branch.id, cashier.id);

  await resetTable(TABLE_ID);

  /**
   * ต้องปิด driver realtime เองเสมอ
   * — ตอน REALTIME_DRIVER=postgres มันถือ connection ที่ LISTEN ค้างไว้
   * ถ้าไม่ปิด process จะไม่จบ (สคริปต์ค้างเงียบ ๆ ทั้งที่เทสต์ผ่านหมดแล้ว)
   */
  await stopRealtime();
  console.log("cleanup done");
}

/**
 * สลับสาขาเป็นเวียดนามชั่วคราวแล้วปิดบิลจริงหนึ่งใบ
 *
 * จุดประสงค์: พิสูจน์ว่าเส้นทางรับเงินไม่มีที่ไหน hardcode "สตางค์" ไว้เลย
 * เลข 25000 ในสาขาไทยแปลว่า 250.00 บาท แต่ในสาขาเวียดนามแปลว่า 25,000 ₫
 * ทั้งสองกรณีต้องเดินสูตรเดียวกันและได้จำนวนเต็มเหมือนกัน
 *
 * ค่าเดิมของสาขาถูกคืนใน finally เสมอ แม้เคสจะพัง
 */
async function runVietnamCase(branchId: string, cashierId: string) {
  const original = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });

  try {
    await prisma.branch.update({
      where: { id: branchId },
      data: {
        currency: "VND" as Currency,
        // เวียดนามคิด VAT 8% แบบบวกเพิ่มท้ายบิล และร้านนี้ไม่เก็บเซอร์วิสชาร์จ
        vatRateBp: 800,
        pricesIncludeVat: false,
        serviceChargeBp: 0,
      },
    });

    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const cashier = await prisma.staff.findUniqueOrThrow({
      where: { id: cashierId },
      include: { branch: true },
    });

    await resetTable(TABLE_ID);
    await seedTwoOrders(branch.id, branch.timezone);

    const bill = (await getTableBill(branch.id, TABLE_ID))!.bill;
    const result = await takePayment(cashier, TABLE_ID, { method: "QR" });

    check("สาขาเวียดนาม: ปิดบิลได้", result.ok, result.ok ? "" : result.errorKey);

    if (!result.ok) {
      return;
    }

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: result.paymentId },
      include: { orders: true },
    });

    check("สาขาเวียดนาม: snapshot สกุลเงินเป็น VND", payment.currency === "VND");
    check(
      "สาขาเวียดนาม: ยอดตรงกับ calculateBill()",
      payment.grandTotal ===
        calculateBill({
          subtotal: bill.subtotal,
          rates: { serviceChargeBp: 0, vatRateBp: 800, pricesIncludeVat: false },
        }).grandTotal,
      formatMoney(payment.grandTotal, "VND"),
    );
    check(
      "สาขาเวียดนาม: VAT ถูกบวกเพิ่ม ไม่ใช่ถอดออก",
      payment.grandTotal > payment.subtotal && payment.netAmount === payment.subtotal,
    );
    check(
      "สาขาเวียดนาม: sum(order.grandTotal) ยังเท่ากับยอดที่จ่าย",
      payment.orders.reduce((sum, order) => sum + order.grandTotal, 0) === payment.grandTotal,
    );
    check(
      "สาขาเวียดนาม: ทุกยอดเป็นจำนวนเต็ม",
      [payment.subtotal, payment.vatAmount, payment.netAmount, payment.grandTotal].every(
        Number.isInteger,
      ),
    );
  } finally {
    await resetTable(TABLE_ID);
    await prisma.branch.update({
      where: { id: branchId },
      data: {
        currency: original.currency,
        vatRateBp: original.vatRateBp,
        pricesIncludeVat: original.pricesIncludeVat,
        serviceChargeBp: original.serviceChargeBp,
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await stopRealtime();
    await prisma.$disconnect();
    process.exit(1);
  });
