import "dotenv/config";

import {
  ORDER_TYPE_FOR_SALE_POINT,
  SALE_POINT_LABEL,
  billRatesForSalePoint,
  chargesServiceCharge,
  joinsExistingSession,
  needsQueueNumber,
  showsInTableMap,
} from "@/lib/sale-point";
import { branchDayKey } from "@/lib/branch-day";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { getSessionBill, getTableBill } from "@/lib/server/billing";
import { prisma } from "@/lib/server/db";
import {
  getOpenSalePointSessions,
  getPosSession,
  getPosTables,
  openSalePointSession,
} from "@/lib/server/pos";
import {
  openOrJoinTableSession,
  openTableSession,
  resolveCustomerContext,
} from "@/lib/server/table-session";
import { takePayment } from "@/lib/server/payment";
import type { SalePointKind } from "@/lib/generated/prisma/enums";

/**
 * Smoke test ของช่องทางขาย "ซื้อกลับหน้าร้าน" (แผน takeaway ข้อ 1-2)
 *
 *     npm run smoke:takeaway
 *
 * ใช้จุดขาย `seed-counter-1` ซึ่งเป็นแถวใน RestaurantTable ที่ `kind = COUNTER`
 * จึงไม่ชนกับสคริปต์อื่นที่ใช้โต๊ะ A1/A2/A3/B1/B2
 *
 * สิ่งที่ก้อนนี้ต้องพิสูจน์ และเป็นเหตุผลที่เขียนเทสต์ก่อนโค้ด:
 *   1. เคาน์เตอร์ **เปิดบิลใหม่ทุกครั้ง** ไม่เข้าร่วมบิลที่เปิดค้างอยู่
 *      (ลูกค้าซื้อกลับสองคนที่มาพร้อมกันต้องไม่ได้บิลใบเดียวกัน)
 *   2. บิลซื้อกลับ **ไม่คิดเซอร์วิสชาร์จ** — ข้อที่ถ้าพลาดคือลูกค้าโดนเก็บเงินเกินทุกใบ
 *   3. โต๊ะนั่งต้องมีพฤติกรรมเหมือนเดิมเป๊ะ (regression ของบทที่ 5/9/10)
 */

const COUNTER_ID = "seed-counter-1";
const COUNTER_CODE = "counter1";
const DINE_IN_ID = "seed-table-a2";

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
    process.exitCode = 1;
  }
}

/**
 * ล้างรอบขายของจุดขายหนึ่งจุด
 *
 * ลำดับการลบสำคัญ: ออร์เดอร์ → ใบเสร็จ → การรับเงิน → รอบขาย
 * (Order→Payment, Receipt→Payment, Payment→TableSession เป็น Restrict ทั้งเส้น)
 */
async function resetSalePoint(tableId: string) {
  const sessions = await prisma.tableSession.findMany({
    where: { tableId },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);

  await prisma.order.deleteMany({ where: { tableSessionId: { in: sessionIds } } });

  const paymentIds = (
    await prisma.payment.findMany({
      where: { tableSessionId: { in: sessionIds } },
      select: { id: true },
    })
  ).map((payment) => payment.id);

  await prisma.receipt.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.restaurantTable.update({
    where: { id: tableId },
    data: { status: "AVAILABLE" },
  });
}

const ALL_KINDS: SalePointKind[] = ["DINE_IN", "COUNTER", "DELIVERY"];

async function main() {
  console.log("── 1. กติกาของจุดขาย (ตรรกะบริสุทธิ์ ไม่แตะ DB) ─────────────────\n");

  check(
    "COUNTER → OrderType.TAKEAWAY",
    ORDER_TYPE_FOR_SALE_POINT.COUNTER === "TAKEAWAY",
    ORDER_TYPE_FOR_SALE_POINT.COUNTER,
  );
  check(
    "DINE_IN → OrderType.DINE_IN",
    ORDER_TYPE_FOR_SALE_POINT.DINE_IN === "DINE_IN",
    ORDER_TYPE_FOR_SALE_POINT.DINE_IN,
  );
  check(
    "DELIVERY → OrderType.DELIVERY",
    ORDER_TYPE_FOR_SALE_POINT.DELIVERY === "DELIVERY",
    ORDER_TYPE_FOR_SALE_POINT.DELIVERY,
  );

  // กติกาสามข้อที่ผูกกับ "จุดขาย" ไม่ใช่กับบิล — ทุกข้อต้องเป็นจริงเฉพาะโต๊ะนั่ง
  check("เข้าร่วมบิลเดิมได้: เฉพาะโต๊ะนั่ง", joinsExistingSession("DINE_IN") === true);
  check("เข้าร่วมบิลเดิมไม่ได้: เคาน์เตอร์", joinsExistingSession("COUNTER") === false);
  check("เข้าร่วมบิลเดิมไม่ได้: ไรเดอร์", joinsExistingSession("DELIVERY") === false);

  check("คิดเซอร์วิสชาร์จ: เฉพาะโต๊ะนั่ง", chargesServiceCharge("DINE_IN") === true);
  check("ไม่คิดเซอร์วิสชาร์จ: เคาน์เตอร์", chargesServiceCharge("COUNTER") === false);
  check("ไม่คิดเซอร์วิสชาร์จ: ไรเดอร์", chargesServiceCharge("DELIVERY") === false);

  check("ขึ้นผังโต๊ะ: เฉพาะโต๊ะนั่ง", showsInTableMap("DINE_IN") === true);
  check("ไม่ขึ้นผังโต๊ะ: เคาน์เตอร์", showsInTableMap("COUNTER") === false);

  check("ต้องมีเลขคิว: เคาน์เตอร์", needsQueueNumber("COUNTER") === true);
  check("ไม่ต้องมีเลขคิว: โต๊ะนั่ง (มีชื่อโต๊ะให้เรียกอยู่แล้ว)", needsQueueNumber("DINE_IN") === false);

  check(
    "ทุก SalePointKind มีป้ายภาษาไทย (ไม่มีค่าไหนหลุดเป็น undefined)",
    ALL_KINDS.every((kind) => typeof SALE_POINT_LABEL[kind] === "string" && SALE_POINT_LABEL[kind].length > 0),
    ALL_KINDS.map((kind) => SALE_POINT_LABEL[kind]).join(" · "),
  );

  console.log("\n── 2. อัตราที่ใช้คิดบิลตามช่องทาง ────────────────────────────────\n");

  const branchRates = { serviceChargeBp: 1000, vatRateBp: 700, pricesIncludeVat: true };

  const dineInRates = billRatesForSalePoint("DINE_IN", branchRates);
  check(
    "โต๊ะนั่งใช้เซอร์วิสชาร์จของสาขาตามเดิม",
    dineInRates.serviceChargeBp === 1000,
    String(dineInRates.serviceChargeBp),
  );

  const counterRates = billRatesForSalePoint("COUNTER", branchRates);
  check("เคาน์เตอร์ได้ serviceChargeBp = 0", counterRates.serviceChargeBp === 0, String(counterRates.serviceChargeBp));
  check(
    "เคาน์เตอร์ยังคิด VAT ตามเดิม (ซื้อกลับไม่ได้แปลว่าไม่มี VAT)",
    counterRates.vatRateBp === 700 && counterRates.pricesIncludeVat === true,
    `vat=${counterRates.vatRateBp} incl=${counterRates.pricesIncludeVat}`,
  );
  check(
    "billRatesForSalePoint ไม่แก้ object ที่รับเข้ามา (ต้องคืนก้อนใหม่)",
    branchRates.serviceChargeBp === 1000,
    String(branchRates.serviceChargeBp),
  );

  console.log("\n── 3. เปิดรอบขาย: เคาน์เตอร์ต้องได้บิลคนละใบ ────────────────────\n");

  await resetSalePoint(COUNTER_ID);
  await resetSalePoint(DINE_IN_ID);

  const counter = await prisma.restaurantTable.findUniqueOrThrow({
    where: { id: COUNTER_ID },
    include: { branch: true },
  });

  check("จุดขาย seed-counter-1 มี kind = COUNTER", counter.kind === "COUNTER", counter.kind);

  const first = await openOrJoinTableSession({
    tableId: counter.id,
    branchId: counter.branchId,
    pax: 1,
  });
  const second = await openOrJoinTableSession({
    tableId: counter.id,
    branchId: counter.branchId,
    pax: 1,
  });

  check(
    "เปิดเคาน์เตอร์สองครั้ง = สองรอบขายคนละใบ",
    first.id !== second.id,
    `${first.id.slice(-6)} vs ${second.id.slice(-6)}`,
  );

  const openAtCounter = await prisma.tableSession.count({
    where: { tableId: counter.id, status: "OPEN" },
  });
  check("เคาน์เตอร์มีรอบเปิดพร้อมกันได้หลายรอบ", openAtCounter === 2, `${openAtCounter} รอบ`);

  // regression: โต๊ะนั่งต้องยัง "เข้าร่วมรอบเดิม" เหมือนเดิมทุกประการ
  const dineTable = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: DINE_IN_ID } });
  const dineFirst = await openOrJoinTableSession({
    tableId: dineTable.id,
    branchId: dineTable.branchId,
    pax: 2,
  });
  const dineSecond = await openOrJoinTableSession({
    tableId: dineTable.id,
    branchId: dineTable.branchId,
    pax: 2,
  });
  check(
    "โต๊ะนั่งเปิดสองครั้ง = รอบเดิม (สี่คนต้องได้บิลใบเดียว)",
    dineFirst.id === dineSecond.id,
    dineFirst.id.slice(-6),
  );

  console.log("\n── 4. เลขคิว ─────────────────────────────────────────────────────\n");

  const today = branchDayKey(counter.branch.timezone);
  check("branchDayKey คืนรูปแบบ YYYYMMDD", /^\d{8}$/.test(today), today);

  check("รอบแรกของเคาน์เตอร์ได้เลขคิว", typeof first.queueNumber === "number", String(first.queueNumber));
  check(
    "เลขคิวเดินขึ้นทีละหนึ่ง",
    typeof second.queueNumber === "number" && second.queueNumber === (first.queueNumber ?? 0) + 1,
    `${first.queueNumber} → ${second.queueNumber}`,
  );
  check("queueDay = วันของสาขา", first.queueDay === today, `${first.queueDay} vs ${today}`);
  check("โต๊ะนั่งไม่มีเลขคิว", dineFirst.queueNumber === null && dineFirst.queueDay === null);

  console.log("\n── 5. บิลซื้อกลับไม่มีเซอร์วิสชาร์จ ──────────────────────────────\n");

  const added = await addToCart({
    tableSessionId: first.id,
    branchId: counter.branchId,
    tableId: counter.id,
    timezone: counter.branch.timezone,
    menuItemId: KRAPAO,
    quantity: 2,
    modifierIds: KRAPAO_OPTIONS,
    note: null,
    channel: "POS",
  });
  check("ใส่เมนูลงบิลซื้อกลับได้", added.ok === true, added.ok ? "" : added.error);

  const placed = await placeOrder(first.id);
  check("ส่งออร์เดอร์ซื้อกลับได้", placed.ok === true, placed.ok ? "" : placed.error);

  const counterOrder = await prisma.order.findFirstOrThrow({
    where: { tableSessionId: first.id },
  });
  check(
    "Order.type ของบิลเคาน์เตอร์ = TAKEAWAY (ไม่ใช่ค่า default ที่ไม่มีใครเขียน)",
    counterOrder.type === "TAKEAWAY",
    counterOrder.type,
  );

  /**
   * เคาน์เตอร์มีบิลเปิดสองใบ (first ที่มีของ · second ที่ว่าง) — ต้องระบุว่าใบไหน
   * `getTableBill()` ที่ถามด้วย tableId เฉย ๆ จะได้ "รอบล่าสุด" ซึ่งคือใบที่ว่าง
   */
  const counterBill = await getSessionBill(counter.branchId, first.id);
  check("getSessionBill คืนบิลของรอบที่ระบุได้", counterBill !== null && !counterBill.isEmpty);

  const latestAtCounter = await getTableBill(counter.branchId, counter.id);
  check(
    "getTableBill ที่เคาน์เตอร์ได้ 'รอบล่าสุด' ซึ่งเป็นคนละใบกับที่มีของ (จึงห้ามใช้ทางเข้านี้กับเคาน์เตอร์)",
    latestAtCounter !== null && latestAtCounter.session?.id === second.id,
    latestAtCounter?.session?.id.slice(-6),
  );

  if (counterBill && !counterBill.isEmpty) {
    check(
      "เซอร์วิสชาร์จของบิลซื้อกลับ = 0",
      counterBill.bill.serviceChargeAmount === 0,
      String(counterBill.bill.serviceChargeAmount),
    );
    check(
      "อัตราเซอร์วิสชาร์จที่ติดไปกับบิล = 0 (ใบเสร็จต้องไม่พิมพ์บรรทัดค่าบริการ)",
      counterBill.bill.serviceChargeBp === 0,
      String(counterBill.bill.serviceChargeBp),
    );
    check(
      "grandTotal = ค่าอาหารพอดี (ราคารวม VAT แล้ว จึงไม่มีอะไรบวกเพิ่ม)",
      counterBill.bill.grandTotal === counterBill.bill.subtotal,
      `${counterBill.bill.grandTotal} vs ${counterBill.bill.subtotal}`,
    );
    check(
      "ยังถอด VAT ออกมาแสดงตามปกติ",
      counterBill.bill.vatAmount > 0 &&
        counterBill.bill.netAmount + counterBill.bill.vatAmount === counterBill.bill.grandTotal,
      `net=${counterBill.bill.netAmount} vat=${counterBill.bill.vatAmount}`,
    );
    check(
      "สาขายังตั้งเซอร์วิสชาร์จไว้จริง (ถ้าสาขาเป็น 0 อยู่แล้ว เทสต์ข้างบนพิสูจน์อะไรไม่ได้)",
      counterBill.branch.serviceChargeBp > 0,
      String(counterBill.branch.serviceChargeBp),
    );
  }

  console.log("\n── 6. regression: บิลโต๊ะนั่งยังคิดเซอร์วิสชาร์จเหมือนเดิม ──────\n");

  await addToCart({
    tableSessionId: dineFirst.id,
    branchId: dineTable.branchId,
    tableId: dineTable.id,
    timezone: counter.branch.timezone,
    menuItemId: KRAPAO,
    quantity: 2,
    modifierIds: KRAPAO_OPTIONS,
    note: null,
    channel: "POS",
  });
  await placeOrder(dineFirst.id);

  const dineBill = await getTableBill(dineTable.branchId, dineTable.id);
  if (dineBill && !dineBill.isEmpty) {
    check(
      "โต๊ะนั่งยังมีเซอร์วิสชาร์จ > 0",
      dineBill.bill.serviceChargeAmount > 0,
      String(dineBill.bill.serviceChargeAmount),
    );
    check(
      "โต๊ะนั่งจ่ายมากกว่าซื้อกลับที่สั่งของเหมือนกันเป๊ะ",
      counterBill !== null && dineBill.bill.grandTotal > counterBill.bill.grandTotal,
      `${dineBill.bill.grandTotal} > ${counterBill?.bill.grandTotal}`,
    );
  }

  const dineOrder = await prisma.order.findFirstOrThrow({
    where: { tableSessionId: dineFirst.id },
  });
  check("Order.type ของบิลโต๊ะ = DINE_IN", dineOrder.type === "DINE_IN", dineOrder.type);

  console.log("\n── 7. เคาน์เตอร์ไม่โผล่ที่ไหนที่ไม่ควรโผล่ ──────────────────────\n");

  const posTables = await getPosTables(counter.branchId);
  check(
    "ผังโต๊ะของ /pos ไม่มีเคาน์เตอร์",
    posTables.every((table) => table.id !== COUNTER_ID),
    `${posTables.length} จุด`,
  );
  const dineInCount = await prisma.restaurantTable.count({
    where: { branchId: counter.branchId, isActive: true, kind: "DINE_IN" },
  });
  check(
    "ผังโต๊ะยังมีโต๊ะนั่งครบทุกโต๊ะ (กรองแล้วต้องไม่หายไปด้วย)",
    posTables.length === dineInCount && dineInCount > 0,
    `${posTables.length} จาก ${dineInCount} — ${posTables.map((table) => table.name).join(", ")}`,
  );

  /**
   * `resolveCustomerContext()` ปฏิเสธที่ด่าน kind **ก่อน** จะไปแตะ cookie
   * จึงเรียกจากสคริปต์ได้ (โต๊ะนั่งจะไปตายที่ `cookies()` เพราะไม่มี request scope
   * — นั่นคือเหตุผลที่ไม่มีเคสฝั่งโต๊ะนั่งตรงนี้ ไม่ใช่เพราะไม่สำคัญ)
   */
  const scanned = await resolveCustomerContext(COUNTER_CODE);
  check(
    "ลูกค้าสแกน QR ของเคาน์เตอร์ไม่ได้ (กันเปิดบิลซื้อกลับเองจากที่บ้าน)",
    scanned === null,
    scanned === null ? "" : "resolve ผ่าน ซึ่งไม่ควรผ่าน",
  );

  // เส้นทางที่ "เขียนจริง" ต้องมีด่านเดียวกัน — ตัวนี้คืน null ก่อนถึง cookie เช่นกัน
  const openedByScan = await openTableSession(COUNTER_CODE, 1);
  check("เปิดรอบเคาน์เตอร์ผ่านเส้นทางลูกค้า (openTableSession) ไม่ได้", openedByScan === null);

  console.log("\n── 8. รับเงินต้องไม่เดาว่าเป็นบิลใบไหน ──────────────────────────\n");

  const cashierStaff = await prisma.staff.findFirstOrThrow({
    where: { code: "002" },
    include: { branch: true },
  });

  /**
   * เคสที่อันตรายที่สุดของก้อนนี้: เคาน์เตอร์มีบิลเปิดสองใบ ถ้า takePayment()
   * หยิบ "รอบล่าสุด" มาปิดเอง ลูกค้าคิว 12 จ่ายเงินแล้วบิลของคิว 14 จะถูกปิดแทน
   */
  const ambiguous = await takePayment(cashierStaff, counter.id, { method: "CASH" });
  check(
    "รับเงินที่เคาน์เตอร์โดยไม่ระบุบิล = ปฏิเสธ ไม่ใช่เดาเอา",
    ambiguous.ok === false,
    ambiguous.ok ? "ปิดบิลไปแล้ว ซึ่งไม่ควรเกิด" : ambiguous.error,
  );

  const stillOpen = await prisma.tableSession.count({
    where: { tableId: counter.id, status: "OPEN" },
  });
  check("การปฏิเสธข้างบนต้องไม่ปิดรอบไหนเลย", stillOpen === 2, `${stillOpen} รอบ`);

  const paid = await takePayment(cashierStaff, counter.id, {
    method: "CASH",
    sessionId: first.id,
    receivedAmount: counterBill?.bill.grandTotal ?? 0,
    expectedTotal: counterBill?.bill.grandTotal ?? undefined,
  });
  check("ระบุบิลแล้วรับเงินได้", paid.ok === true, paid.ok ? "" : paid.error);

  if (paid.ok) {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paid.paymentId } });
    check(
      "รับเงินถูกใบ (รอบที่มีของ ไม่ใช่รอบที่ว่าง)",
      payment.tableSessionId === first.id,
      payment.tableSessionId.slice(-6),
    );
    check(
      "Payment snapshot เซอร์วิสชาร์จเป็น 0 ตลอดไป (ใบเสร็จซื้อกลับต้องไม่มีบรรทัดค่าบริการ)",
      payment.serviceChargeBp === 0 && payment.serviceChargeAmount === 0,
      `bp=${payment.serviceChargeBp} amount=${payment.serviceChargeAmount}`,
    );
    check(
      "บิลที่เหลืออีกใบยังเปิดอยู่ ไม่ถูกปิดตามไปด้วย",
      (await prisma.tableSession.findUniqueOrThrow({ where: { id: second.id } })).status === "OPEN",
    );
  }

  console.log("\n── 9. ทางเข้าของหน้าจอเคาน์เตอร์ ────────────────────────────────\n");

  const third = await openSalePointSession(cashierStaff, counter.id);
  check("เปิดบิลซื้อกลับใบใหม่ผ่าน openSalePointSession ได้", third.ok === true);

  const onDineIn = await openSalePointSession(cashierStaff, DINE_IN_ID);
  check(
    "openSalePointSession ปฏิเสธโต๊ะนั่ง (กันเปิดบิลซ้อนบนโต๊ะที่ลูกค้านั่งอยู่)",
    onDineIn.ok === false,
    onDineIn.ok ? "ผ่าน ซึ่งไม่ควรผ่าน" : onDineIn.error,
  );

  if (third.ok) {
    const detail = await getPosSession(counter.branchId, third.ok ? third.session.id : "");
    check(
      "getPosSession คืนรอบที่ระบุ ไม่ใช่รอบล่าสุด",
      detail !== null && detail.session?.id === third.session.id,
      detail?.session?.id.slice(-6),
    );
    check(
      "getPosSession บอกจำนวนบิลที่เปิดอยู่ของจุดขายนั้นมาด้วย",
      (detail?.openSessionCount ?? 0) >= 2,
      String(detail?.openSessionCount),
    );
  }

  const queue = await getOpenSalePointSessions(counter.branchId);
  check("แถบคิวเห็นบิลซื้อกลับที่ยังไม่ปิด", queue.length >= 2, `${queue.length} ใบ`);
  check(
    "แถบคิวเรียงตามเลขคิวจากน้อยไปมาก (คนที่รอนานที่สุดอยู่บนสุด)",
    queue.every((entry, index) => index === 0 || (entry.queueNumber ?? 0) >= (queue[index - 1].queueNumber ?? 0)),
    queue.map((entry) => entry.queueNumber).join(", "),
  );
  check(
    "แถบคิวไม่มีโต๊ะนั่งปนมา",
    queue.every((entry) => entry.table.kind !== "DINE_IN"),
    queue.map((entry) => entry.table.kind).join(", "),
  );
  check(
    "บิลที่รับเงินไปแล้วหลุดออกจากแถบคิว",
    queue.every((entry) => entry.id !== first.id),
  );

  console.log("\n── ล้างข้อมูลที่สร้างระหว่างทดสอบ ───────────────────────────────\n");

  await resetSalePoint(COUNTER_ID);
  await resetSalePoint(DINE_IN_ID);

  const leftover = await prisma.tableSession.count({ where: { tableId: COUNTER_ID } });
  check("ล้างรอบขายของเคาน์เตอร์หมดแล้ว", leftover === 0, `${leftover} รอบ`);

  console.log(`\nรวม ${passed + failed} เคส — PASS ${passed} · FAIL ${failed}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
