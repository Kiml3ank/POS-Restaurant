import "dotenv/config";

import { en } from "@/lib/i18n/en";
import { translate, type MessageParams } from "@/lib/i18n/translate";
import { vi, type MessageKey } from "@/lib/i18n/vi";
import {
  ORDER_TYPE_FOR_SALE_POINT,
  billRatesForSalePoint,
  chargesServiceCharge,
  joinsExistingSession,
  needsQueueNumber,
  salePointBasePath,
  salePointDisplayName,
  salePointFieldLabel,
  salePointKey,
  showsInTableMap,
} from "@/lib/sale-point";
import { branchDayKey } from "@/lib/branch-day";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { getSessionBill, getTableBill } from "@/lib/server/billing";
import { prisma } from "@/lib/server/db";
import { getKitchenTickets } from "@/lib/server/kds";
import {
  getOpenSalePointSessions,
  getPosSession,
  getPosTables,
  openSalePointSession,
  setSessionCustomerName,
} from "@/lib/server/pos";
import {
  openOrJoinTableSession,
  openTableSession,
  resolveCustomerContext,
} from "@/lib/server/table-session";
import { takePayment } from "@/lib/server/payment";
import { listReceipts } from "@/lib/server/receipt";
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
 *   4. ตั๋วครัวและใบเสร็จของบิลซื้อกลับต้องเรียกบิลด้วย **เลขคิว** ไม่ใช่ชื่อช่อง
 *      (ครัวอ่านชื่อช่องซึ่งเหมือนกันทุกใบแล้วไม่รู้ว่าเป็นของลูกค้าคนไหน)
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

  // tsc ตรวจอยู่แล้วว่าคีย์มีจริง (salePointKey คืน MessageKey) — ที่นี่กันคำแปลว่าง
  check(
    "ทุก SalePointKind มีป้ายทั้งสองภาษา (ไม่มีค่าไหนว่าง)",
    ALL_KINDS.every(
      (kind) =>
        translate(vi, salePointKey(kind)).trim().length > 0 &&
        translate(en, salePointKey(kind)).trim().length > 0,
    ),
    ALL_KINDS.map((kind) => `${translate(vi, salePointKey(kind))}/${translate(en, salePointKey(kind))}`).join(" · "),
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
  check("ใส่เมนูลงบิลซื้อกลับได้", added.ok === true, added.ok ? "" : added.errorKey);

  const placed = await placeOrder(first.id);
  check("ส่งออร์เดอร์ซื้อกลับได้", placed.ok === true, placed.ok ? "" : placed.errorKey);

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


  console.log("\n── 7. ชื่อบิลบนตั๋วครัวและใบเสร็จ ───────────────────────────────\n");

  /**
   * ก่อนก้อนนี้ ทุกที่ในระบบเขียน `table.name` ตรง ๆ แล้วแปะคำว่า "โต๊ะ" ไว้ข้างหน้า
   * พอมีเคาน์เตอร์ ครัวจึงได้ตั๋วที่เขียนว่า "เคาน์เตอร์ซื้อกลับ" เหมือนกันทุกใบ
   * — บอก **ชื่อช่อง** แทนที่จะบอกว่าเป็นบิลของใคร ซึ่งที่เคาน์เตอร์คือเลขคิว
   * (ร้านมีเคาน์เตอร์เดียวแต่ลูกค้าหลายคน ชื่อช่องจึงไม่ช่วยอะไรเลย)
   */
  /**
   * ตัวแปลสองภาษาจากพจนานุกรมจริง — ตรวจ **กฎ** ในทั้งสองภาษา ไม่ใช่ประโยค
   * ภาษาเดียวที่ฮาร์ดโค้ดไว้ (ท่านั้นคือสิ่งที่ทำให้เทสต์ชุดนี้พังทุกครั้งที่แปล)
   */
  const tvi = (key: MessageKey, params?: MessageParams) => translate(vi, key, params);
  const ten = (key: MessageKey, params?: MessageParams) => translate(en, key, params);
  const both = (
    table: Parameters<typeof salePointDisplayName>[0],
    session: Parameters<typeof salePointDisplayName>[1],
  ) => `${salePointDisplayName(table, session, tvi)} | ${salePointDisplayName(table, session, ten)}`;

  check(
    "ชื่อบิลของโต๊ะนั่ง = คำว่าโต๊ะ + ชื่อโต๊ะ (ทั้งสองภาษา)",
    both(dineTable, dineFirst) === `Bàn ${dineTable.name} | Table ${dineTable.name}`,
    both(dineTable, dineFirst),
  );
  check(
    "ชื่อบิลของเคาน์เตอร์ = ช่องทาง + เลขคิว (ทั้งสองภาษา)",
    both(counter, first) === `Mang đi #${first.queueNumber} | Takeaway #${first.queueNumber}`,
    both(counter, first),
  );
  check(
    "ชื่อบิลของเคาน์เตอร์ไม่ใช่ชื่อช่อง (บั๊กเดิมที่ครัวอ่านแล้วไม่รู้ว่าของใคร)",
    !salePointDisplayName(counter, first, tvi).includes(counter.name) &&
      !salePointDisplayName(counter, first, ten).includes(counter.name),
    `ชื่อช่องคือ "${counter.name}"`,
  );
  check(
    "ไรเดอร์ใช้กฎเดียวกับเคาน์เตอร์ (ช่องทาง + เลขคิว)",
    both({ name: "Rider slot", kind: "DELIVERY" }, { queueNumber: 7 }) ===
      "Giao hàng #7 | Delivery #7",
    both({ name: "Rider slot", kind: "DELIVERY" }, { queueNumber: 7 }),
  );
  check(
    "ไม่มีเลขคิว (ข้อมูลก่อนมีคอลัมน์นี้) ตกกลับไปใช้ชื่อจุดขาย ไม่ใช่คำว่า '#null'",
    both(counter, null) === `Mang đi · ${counter.name} | Takeaway · ${counter.name}`,
    both(counter, null),
  );
  check(
    "โต๊ะนั่งที่มีเลขคิวติดมาด้วยยังอ่านว่า 'โต๊ะ' (กฎตัดสินที่ kind ไม่ใช่ที่ว่ามีเลขคิวไหม)",
    both(dineTable, { queueNumber: 99 }) === `Bàn ${dineTable.name} | Table ${dineTable.name}`,
    both(dineTable, { queueNumber: 99 }),
  );
  /**
   * ลิงก์ที่พาไปผิดตระกูล URL เป็นบั๊กเงียบ: หน้าเปิดได้ 200 เหมือนกัน แต่พนักงาน
   * ไปอยู่บนเส้นทางของโต๊ะทั้งที่ถือบิลซื้อกลับ (เจอจริงที่หน้าใบเสร็จของจอ POS)
   */
  check(
    "เส้นทางฐานของโต๊ะนั่งชี้ด้วย tableId",
    salePointBasePath(dineTable, dineFirst) === `/pos/table/${dineTable.id}`,
    salePointBasePath(dineTable, dineFirst),
  );
  check(
    "เส้นทางฐานของเคาน์เตอร์ชี้ด้วย sessionId (เพราะมีบิลเปิดพร้อมกันได้หลายใบ)",
    salePointBasePath(counter, first) === `/pos/counter/${first.id}`,
    salePointBasePath(counter, first),
  );
  check(
    "ป้ายของช่องข้อมูลบนใบเสร็จ: โต๊ะนั่ง = 'โต๊ะ' · ที่เหลือ = 'ช่องทาง' (ทั้งสองภาษา)",
    salePointFieldLabel("DINE_IN", tvi) === "Bàn" &&
      salePointFieldLabel("COUNTER", tvi) === "Kênh bán" &&
      salePointFieldLabel("DELIVERY", tvi) === "Kênh bán" &&
      salePointFieldLabel("DINE_IN", ten) === "Table" &&
      salePointFieldLabel("COUNTER", ten) === "Channel" &&
      salePointFieldLabel("DELIVERY", ten) === "Channel",
  );

  /**
   * ชั้นที่พังได้จริงคือ query ไม่ใช่ฟังก์ชัน — ถ้า `getKitchenTickets()` ลืม
   * select `tableSession.queueNumber` ฟังก์ชันข้างบนจะยังผ่านหมด แต่ตั๋วจริง
   * บนจอครัวจะตกไปใช้ชื่อช่องทั้งวันโดยไม่มีอะไรฟ้อง
   */
  const tickets = await getKitchenTickets(counter.branchId);
  const counterTicket = tickets.find((ticket) => ticket.id === counterOrder.id);
  const dineTicket = tickets.find((ticket) => ticket.id === dineOrder.id);

  check("ตั๋วครัวของบิลซื้อกลับขึ้นจอ", counterTicket !== undefined, `${tickets.length} ใบบนจอ`);
  check("ตั๋วครัวของบิลโต๊ะนั่งขึ้นจอ", dineTicket !== undefined);
  check(
    "ตั๋วครัวดึงเลขคิวมาด้วยจริง (ไม่ใช่แค่ฟังก์ชันแปลงป้ายที่ถูก)",
    counterTicket?.tableSession?.queueNumber === first.queueNumber,
    String(counterTicket?.tableSession?.queueNumber),
  );
  /**
   * `ticket.table` เป็น null ได้ตาม schema (ออร์เดอร์ที่ไม่ผูกจุดขาย) จอครัวจึงมี
   * ternary คุมอยู่ — ที่นี่ต้องเดินทางเดียวกัน ไม่ใช่ใส่ ! ทับให้ tsc เงียบ
   */
  const counterTicketLabel = counterTicket?.table
    ? both(counterTicket.table, counterTicket.tableSession)
    : null;
  const dineTicketLabel = dineTicket?.table
    ? both(dineTicket.table, dineTicket.tableSession)
    : null;

  check(
    "ป้ายบนตั๋วซื้อกลับอ่านว่า 'ช่องทาง #N'",
    counterTicketLabel === `Mang đi #${first.queueNumber} | Takeaway #${first.queueNumber}`,
    counterTicketLabel ?? "ไม่มีป้าย",
  );
  check(
    "ป้ายบนตั๋วโต๊ะนั่งไม่เปลี่ยนไปจากเดิม (regression ของบทที่ 8)",
    dineTicketLabel === `Bàn ${dineTable.name} | Table ${dineTable.name}`,
    dineTicketLabel ?? "ไม่มีป้าย",
  );
  console.log("\n── 8. เคาน์เตอร์ไม่โผล่ที่ไหนที่ไม่ควรโผล่ ──────────────────────\n");

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

  console.log("\n── 9. รับเงินต้องไม่เดาว่าเป็นบิลใบไหน ──────────────────────────\n");

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
    ambiguous.ok ? "ปิดบิลไปแล้ว ซึ่งไม่ควรเกิด" : ambiguous.errorKey,
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
  check("ระบุบิลแล้วรับเงินได้", paid.ok === true, paid.ok ? "" : paid.errorKey);

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

    /**
     * เอกสารที่ลูกค้าถือกลับบ้านต้องเรียกบิลด้วยเลขคิวเหมือนตั๋วครัว — ไม่ใช่
     * "โต๊ะ: เคาน์เตอร์ซื้อกลับ" ซึ่งเรียกสิ่งที่ไม่ใช่โต๊ะว่าโต๊ะ
     * (ลิสต์ใบเสร็จเป็นสิทธิ์ของ OWNER/MANAGER จึงต้องเปลี่ยนคนถาม ไม่ใช่แคชเชียร์)
     */
    const ownerStaff = await prisma.staff.findFirstOrThrow({
      where: { code: "001" },
      include: { branch: true },
    });
    const receiptRow = await prisma.receipt.findFirstOrThrow({
      where: { paymentId: paid.paymentId },
      select: { id: true },
    });
    /**
     * ที่เคาน์เตอร์ลูกค้า **จ่ายก่อนแล้วยืนรอ** ของถึงจะออกจากครัว — ถ้าตั๋วหลุด
     * จากจอครัวตอนกดรับเงิน ครัวจะไม่มีวันเห็นออร์เดอร์นั้นเลย (ลูกค้าจ่ายแล้ว
     * แต่ไม่มีใครทำอาหาร) จอครัวจึงต้องกรองด้วยสถานะ **ของรายการ** ไม่ใช่ของบิล
     */
    const ticketsAfterPaid = await getKitchenTickets(counter.branchId);
    check(
      "จ่ายเงินแล้วแต่ครัวยังไม่ได้ทำ = ตั๋วยังอยู่บนจอครัว",
      ticketsAfterPaid.some((ticket) => ticket.id === counterOrder.id),
      `${ticketsAfterPaid.length} ใบบนจอ`,
    );

    const listed = await listReceipts(ownerStaff, {});
    const listedRow = listed.ok ? listed.rows.find((row) => row.id === receiptRow.id) : undefined;
    /**
     * listReceipts() อยู่ใน lib/server จึงคืน **ชิ้นส่วน** ไม่ใช่ชื่อสำเร็จรูป
     * (ชั้นธุรกิจห้ามแปลภาษา) — ตรวจทั้งชิ้นส่วนที่ query ต้องดึงมาให้ครบ
     * และชื่อที่หน้าจอประกอบได้จากชิ้นส่วนนั้นจริง
     */
    check(
      "แถวใบเสร็จซื้อกลับพาเลขคิวมาด้วย (query ไม่ลืม select)",
      listedRow?.salePoint.kind === "COUNTER" &&
        listedRow.salePoint.queueNumber === first.queueNumber,
      JSON.stringify(listedRow?.salePoint ?? "ไม่มีแถว"),
    );
    check(
      "ชื่อบิลบนใบเสร็จซื้อกลับ = ช่องทาง #N (ไม่ใช่ชื่อช่อง ไม่ใช่คำว่าโต๊ะ)",
      listedRow !== undefined &&
        both(listedRow.salePoint, listedRow.salePoint) ===
          `Mang đi #${first.queueNumber} | Takeaway #${first.queueNumber}`,
      listedRow ? both(listedRow.salePoint, listedRow.salePoint) : "ไม่มีแถว",
    );

    /**
     * ลูกค้าที่เดินกลับมาถามถึงใบเสร็จของตัวเองพูดว่า "คิว 12" — บิลซื้อกลับ
     * ไม่มีชื่อโต๊ะให้ค้น ถ้าค้นด้วยเลขคิวไม่ได้ก็ต้องไล่เปิดดูทีละใบ
     */
    const byQueue = await listReceipts(ownerStaff, { q: `คิว ${first.queueNumber}` });
    check(
      "ค้นใบเสร็จด้วย 'คิว N' เจอใบของบิลซื้อกลับ",
      byQueue.ok === true && byQueue.rows.some((row) => row.id === receiptRow.id),
      byQueue.ok ? `${byQueue.rows.length} แถว` : byQueue.errorKey,
    );

    const byOtherQueue = await listReceipts(ownerStaff, { q: "คิว 99999" });
    check(
      "ค้นด้วยเลขคิวที่ไม่มี = ไม่เจอใบนี้ (ไม่ใช่คืนทุกแถว)",
      byOtherQueue.ok === true && !byOtherQueue.rows.some((row) => row.id === receiptRow.id),
      byOtherQueue.ok ? `${byOtherQueue.rows.length} แถว` : byOtherQueue.errorKey,
    );

    const receiptNumber = listedRow?.number ?? "";
    const byNumber = await listReceipts(ownerStaff, { q: receiptNumber });
    check(
      "ค้นด้วยเลขที่ใบยังทำงานเหมือนเดิม (เลขยาวต้องไม่ไปพังที่เงื่อนไขเลขคิว)",
      byNumber.ok === true && byNumber.rows.some((row) => row.id === receiptRow.id),
      byNumber.ok ? `${receiptNumber} → ${byNumber.rows.length} แถว` : byNumber.errorKey,
    );
  }

  console.log("\n── 10. ชื่อลูกค้าของบิลซื้อกลับ ─────────────────────────────────\n");

  /**
   * ใช้บิลใบที่ยังเปิดอยู่ (`second`) เพราะ `first` ถูกปิดไปตอนรับเงินข้างบนแล้ว
   */
  const named = await setSessionCustomerName(cashierStaff, second.id, "  คุณนัท  ");
  check(
    "ตั้งชื่อลูกค้าได้ และตัดช่องว่างหัวท้ายทิ้ง",
    named.ok === true && named.customerName === "คุณนัท",
    named.ok ? String(named.customerName) : named.errorKey,
  );
  check(
    "ชื่อถูกเขียนลงรอบขายจริง",
    (await prisma.tableSession.findUniqueOrThrow({ where: { id: second.id } })).customerName ===
      "คุณนัท",
  );
  check(
    "แถบคิวเห็นชื่อลูกค้า",
    (await getOpenSalePointSessions(counter.branchId)).find((entry) => entry.id === second.id)
      ?.customerName === "คุณนัท",
  );

  const cleared = await setSessionCustomerName(cashierStaff, second.id, "   ");
  check(
    "ส่งค่าว่างมา = ล้างชื่อเป็น null ไม่ใช่เก็บสตริงว่าง (ไม่งั้นจอจะมีบรรทัดเปล่า)",
    cleared.ok === true && cleared.customerName === null,
    cleared.ok ? String(cleared.customerName) : cleared.errorKey,
  );

  const tooLong = await setSessionCustomerName(cashierStaff, second.id, "ก".repeat(41));
  check(
    "ชื่อยาวเกินกำหนด = ปฏิเสธ",
    tooLong.ok === false,
    tooLong.ok ? "ผ่าน ซึ่งไม่ควรผ่าน" : tooLong.errorKey,
  );

  const onDineInName = await setSessionCustomerName(cashierStaff, dineFirst.id, "คุณเอ");
  check(
    "โต๊ะนั่งตั้งชื่อลูกค้าไม่ได้ (ชื่อโต๊ะทำหน้าที่นี้อยู่แล้ว)",
    onDineInName.ok === false,
    onDineInName.ok ? "ผ่าน ซึ่งไม่ควรผ่าน" : onDineInName.errorKey,
  );

  /**
   * รอบที่ปิดไปแล้วต้องแก้ชื่อไม่ได้ — ไม่งั้นชื่อบนใบเสร็จที่พิมพ์ไปแล้วกับชื่อ
   * ในฐานข้อมูลจะไม่ตรงกัน โดยที่ไม่มีร่องรอยเลยว่าใครแก้ตอนไหน
   */
  const onClosed = await setSessionCustomerName(cashierStaff, first.id, "คุณบี");
  check(
    "รอบที่ปิดไปแล้ว (จ่ายเงินแล้ว) ตั้งชื่อไม่ได้",
    onClosed.ok === false,
    onClosed.ok ? "ผ่าน ซึ่งไม่ควรผ่าน" : onClosed.errorKey,
  );

  console.log("\n── 11. ทางเข้าของหน้าจอเคาน์เตอร์ ────────────────────────────────\n");

  const third = await openSalePointSession(cashierStaff, counter.id);
  check("เปิดบิลซื้อกลับใบใหม่ผ่าน openSalePointSession ได้", third.ok === true);

  const onDineIn = await openSalePointSession(cashierStaff, DINE_IN_ID);
  check(
    "openSalePointSession ปฏิเสธโต๊ะนั่ง (กันเปิดบิลซ้อนบนโต๊ะที่ลูกค้านั่งอยู่)",
    onDineIn.ok === false,
    onDineIn.ok ? "ผ่าน ซึ่งไม่ควรผ่าน" : onDineIn.errorKey,
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
