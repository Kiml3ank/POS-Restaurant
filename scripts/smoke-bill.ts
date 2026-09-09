import "dotenv/config";

import { calculateBill, formatBp, type BillRates } from "@/lib/bill";
import { CURRENCIES, formatMoney, formatMoneyDelta, lineTotalOf } from "@/lib/money";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { getTableBill } from "@/lib/server/billing";
import { prisma } from "@/lib/server/db";
import { getPosTable, getPosTables } from "@/lib/server/pos";
import { openOrJoinTableSession, resolveSessionByToken } from "@/lib/server/table-session";
import type { Currency } from "@/lib/generated/prisma/enums";

/**
 * Smoke test ของการคิดเงิน + สกุลเงิน (บทที่ 10)
 *
 *     npm run smoke:bill
 *
 * ส่วนใหญ่เป็นตรรกะบริสุทธิ์ (ไม่แตะ DB) จึงเช็คเลขได้ตรง ๆ ทีละเคส
 * ท้ายไฟล์มีเคสที่ต่อกับ DB จริงเพื่อยืนยันว่า getTableBill() ต่อท่อถูก
 * — ใช้โต๊ะ B2 เพื่อไม่ชนกับสคริปต์อื่น (A1 = smoke:order, A2/A3 = smoke:kds, B1 = smoke:pos)
 */

const BILL_TABLE_ID = "seed-table-b2";

const KRAPAO = "seed-item-krapao";
const WATER = "seed-item-water";
const KRAPAO_OPTIONS = ["seed-mod-spice-mild", "seed-mod-size-regular"];

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const THAI_RATES: BillRates = {
  serviceChargeBp: 1000,
  vatRateBp: 700,
  pricesIncludeVat: true,
};

async function resetTable(tableId: string) {
  const sessions = await prisma.tableSession.findMany({
    where: { tableId },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);

  await prisma.order.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  // ต้องลบหลัง Order (Order → Payment เป็น Restrict) และก่อน TableSession
  // (Payment → TableSession เป็น Restrict) — บทที่ 11
  // ใบเสร็จต้องถูกลบก่อนการรับเงิน — Receipt.paymentId เป็น Restrict (บทที่ 12)
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

async function main() {
  // ── 1. ลำดับ เซอร์วิสชาร์จ → VAT (ราคายังไม่รวม VAT) ─────────────────
  const exclusive = calculateBill({
    subtotal: 100_000, // 1,000.00 บาท
    rates: { serviceChargeBp: 1000, vatRateBp: 700, pricesIncludeVat: false },
  });

  check("เซอร์วิสชาร์จ 10% ของ 1,000 = 100", exclusive.serviceChargeAmount === 10_000);
  check("ฐาน VAT = ค่าอาหาร + เซอร์วิสชาร์จ = 1,100", exclusive.netAmount === 110_000);
  check("VAT 7% ของ 1,100 = 77", exclusive.vatAmount === 7_700, `ได้ ${exclusive.vatAmount}`);
  check("ยอดรวม = 1,177", exclusive.grandTotal === 117_700, `ได้ ${exclusive.grandTotal}`);
  check(
    "netAmount + vatAmount = grandTotal เสมอ",
    exclusive.netAmount + exclusive.vatAmount === exclusive.grandTotal,
  );

  // ── 2. ราคารวม VAT แล้ว → ต้อง "ถอด" ไม่ใช่ "บวก" ────────────────────
  const inclusive = calculateBill({ subtotal: 100_000, rates: THAI_RATES });

  check("ยอดรวมไม่ถูกบวก VAT เพิ่ม = 1,100", inclusive.grandTotal === 110_000);
  check(
    "ถอด VAT จาก 1,100 ได้ 71.96",
    inclusive.vatAmount === 7_196,
    `ได้ ${inclusive.vatAmount}`,
  );
  check(
    "มูลค่าสินค้าก่อน VAT = 1,028.04",
    inclusive.netAmount === 102_804,
    `ได้ ${inclusive.netAmount}`,
  );
  check(
    "net + vat = grand (ไม่มีสตางค์หาย)",
    inclusive.netAmount + inclusive.vatAmount === inclusive.grandTotal,
  );
  check(
    "ถอด VAT ได้น้อยกว่าการคูณ 7% ตรง ๆ (ซึ่งเป็นวิธีที่ผิด)",
    inclusive.vatAmount < 110_000 * 0.07,
    `ถอดได้ ${inclusive.vatAmount} · คูณตรง ๆ จะได้ ${Math.round(110_000 * 0.07)}`,
  );

  // ── 3. การปัดเศษ ─────────────────────────────────────────────────────
  // 33.33 × 10% = 3.333 → ปัดลงเป็น 3.33
  const roundDown = calculateBill({
    subtotal: 3_333,
    rates: { serviceChargeBp: 1000, vatRateBp: 0, pricesIncludeVat: false },
  });
  check("3.333 ปัดลงเป็น 3.33", roundDown.serviceChargeAmount === 333);

  // 5.55 × 10% = 0.555 → ปัดครึ่งขึ้นเป็น 0.56
  const roundHalfUp = calculateBill({
    subtotal: 555,
    rates: { serviceChargeBp: 1000, vatRateBp: 0, pricesIncludeVat: false },
  });
  check("0.555 ปัดครึ่งขึ้นเป็น 0.56", roundHalfUp.serviceChargeAmount === 56);

  check(
    "ทุกค่าที่คืนออกมาเป็นจำนวนเต็มเสมอ",
    Object.values(inclusive).every(
      (value) => typeof value !== "number" || Number.isInteger(value),
    ),
  );

  // เคสที่พิสูจน์ว่าต้องรวมยอดก่อนคิด ไม่ใช่คิดทีละใบแล้วบวก
  const perOrder = [3_333, 3_333, 3_333].reduce(
    (sum, amount) =>
      sum +
      calculateBill({
        subtotal: amount,
        rates: { serviceChargeBp: 1000, vatRateBp: 0, pricesIncludeVat: false },
      }).serviceChargeAmount,
    0,
  );
  const combined = calculateBill({
    subtotal: 9_999,
    rates: { serviceChargeBp: 1000, vatRateBp: 0, pricesIncludeVat: false },
  }).serviceChargeAmount;

  check(
    "คิดทีละใบแล้วบวก ได้คนละค่ากับรวมก่อนคิด",
    perOrder !== combined,
    `ทีละใบ ${perOrder} · รวมก่อน ${combined} — นี่คือเหตุผลที่ getTableBill() รวมก่อนคิด`,
  );

  // ── 4. ส่วนลด ────────────────────────────────────────────────────────
  const discounted = calculateBill({
    subtotal: 100_000,
    discountAmount: 20_000,
    rates: { serviceChargeBp: 1000, vatRateBp: 700, pricesIncludeVat: false },
  });
  check("หักส่วนลดก่อนคิดเซอร์วิสชาร์จ", discounted.serviceChargeAmount === 8_000);
  check("ฐานหลังส่วนลด = 800", discounted.discountedSubtotal === 80_000);

  const overDiscount = calculateBill({
    subtotal: 10_000,
    discountAmount: 99_999,
    rates: THAI_RATES,
  });
  check("ส่วนลดเกินค่าอาหารถูกจำกัดไว้ที่ค่าอาหาร", overDiscount.discountAmount === 10_000);
  check("บิลไม่ติดลบ", overDiscount.grandTotal === 0);

  // ── 5. ร้านที่ไม่เก็บเซอร์วิสชาร์จ / ไม่จด VAT ───────────────────────
  const plain = calculateBill({
    subtotal: 12_345,
    rates: { serviceChargeBp: 0, vatRateBp: 0, pricesIncludeVat: false },
  });
  check(
    "ไม่มีเซอร์วิสชาร์จและไม่มี VAT => จ่ายเท่าค่าอาหาร",
    plain.grandTotal === 12_345 && plain.vatAmount === 0,
  );

  const zeroBill = calculateBill({ subtotal: 0, rates: THAI_RATES });
  check("บิลเปล่าไม่ระเบิดและได้ 0 ทุกช่อง", zeroBill.grandTotal === 0 && zeroBill.vatAmount === 0);

  // ── 6. สกุลเงิน ──────────────────────────────────────────────────────
  check("ตารางสกุลเงินครบทุกตัวใน enum", Object.keys(CURRENCIES).length === 3);

  check("THB 12000 => ฿120.00", formatMoney(12_000, "THB") === "฿120.00", formatMoney(12_000, "THB"));
  check(
    "THB มีตัวคั่นหลักพัน",
    formatMoney(123_456_789, "THB") === "฿1,234,567.89",
    formatMoney(123_456_789, "THB"),
  );
  check("LAK ไม่มีทศนิยม", formatMoney(120_000, "LAK") === "₭120,000", formatMoney(120_000, "LAK"));
  check(
    "VND สัญลักษณ์อยู่ท้าย และคั่นหลักพันด้วยจุด",
    formatMoney(120_000, "VND") === "120.000 ₫",
    formatMoney(120_000, "VND"),
  );
  check("VND หลักเดียวไม่มีตัวคั่น", formatMoney(5, "VND") === "5 ₫", formatMoney(5, "VND"));
  check(
    "ติดลบ: เครื่องหมายอยู่หน้าตัวเลขเสมอ",
    formatMoney(-12_000, "THB") === "-฿120.00" && formatMoney(-5_000, "VND") === "-5.000 ₫",
    `${formatMoney(-12_000, "THB")} · ${formatMoney(-5_000, "VND")}`,
  );
  check("ศูนย์", formatMoney(0, "THB") === "฿0.00" && formatMoney(0, "VND") === "0 ₫");
  check(
    "ส่วนต่างราคาแสดงเครื่องหมายเสมอ",
    formatMoneyDelta(1_500, "THB") === "+฿15.00" && formatMoneyDelta(0, "VND") === "",
  );

  /**
   * เคสสำคัญที่สุดของก้อนสกุลเงิน: เลขก้อนเดียวกันใน DB แปลว่าคนละมูลค่า
   * ถ้าวันหนึ่งมีใครไป hardcode หาร 100 ไว้ เคสนี้จะพัง
   */
  check(
    "เลข 50000 เท่ากันแต่คนละสกุล = คนละมูลค่า",
    formatMoney(50_000, "THB") === "฿500.00" && formatMoney(50_000, "LAK") === "₭50,000",
    `${formatMoney(50_000, "THB")} vs ${formatMoney(50_000, "LAK")}`,
  );

  // บิลของร้านเวียดนาม: VAT 8% ราคายังไม่รวม VAT ไม่มีเซอร์วิสชาร์จ
  const vietnam = calculateBill({
    subtotal: 250_000, // 250,000 ₫
    rates: { serviceChargeBp: 0, vatRateBp: 800, pricesIncludeVat: false },
  });
  check(
    "บิลเวียดนาม 250,000 ₫ + VAT 8% = 270,000 ₫",
    vietnam.grandTotal === 270_000,
    formatMoney(vietnam.grandTotal, "VND"),
  );
  check(
    "ปัดเศษของสกุลไม่มีทศนิยม = ปัดเป็นจำนวนเต็มดอง",
    Number.isInteger(vietnam.vatAmount),
  );

  check("formatBp 1000 => 10%", formatBp(1000) === "10%", formatBp(1000));
  check("formatBp 725 => 7.25%", formatBp(725) === "7.25%", formatBp(725));
  check("formatBp 750 => 7.5%", formatBp(750) === "7.5%", formatBp(750));

  check("lineTotalOf ยังคิดด้วยจำนวนเต็มล้วน", lineTotalOf(6_000, 3_500, 3) === 28_500);

  // ── 7. ต่อกับ DB จริง ────────────────────────────────────────────────
  const branch = await prisma.branch.findFirstOrThrow();
  check(
    "สกุลเงินของสาขาอ่านออกมาเป็นค่าใน enum",
    (Object.keys(CURRENCIES) as Currency[]).includes(branch.currency),
    branch.currency,
  );

  await resetTable(BILL_TABLE_ID);

  const session = await openOrJoinTableSession({
    tableId: BILL_TABLE_ID,
    branchId: branch.id,
    pax: 2,
  });

  const cartLine = {
    tableSessionId: session.id,
    branchId: branch.id,
    tableId: BILL_TABLE_ID,
    timezone: branch.timezone,
    note: null,
  };

  await addToCart({ ...cartLine, menuItemId: KRAPAO, quantity: 2, modifierIds: KRAPAO_OPTIONS });
  await addToCart({ ...cartLine, menuItemId: WATER, quantity: 1, modifierIds: [] });
  await placeOrder(session.id);

  const detail = await getTableBill(branch.id, BILL_TABLE_ID);

  // กะเพรา 60.00 × 2 + น้ำเปล่า 20.00 = 140.00
  check("บิลรวมทุกบรรทัดของรอบโต๊ะ", detail?.bill.subtotal === 14_000, `ได้ ${detail?.bill.subtotal}`);
  check("แสดง 3 ชิ้นจาก 2 บรรทัด", detail?.lines.length === 2);
  check(
    "ยอดตรงกับที่ calculateBill คิดให้",
    detail?.bill.grandTotal ===
      calculateBill({
        subtotal: 14_000,
        rates: {
          serviceChargeBp: branch.serviceChargeBp,
          vatRateBp: branch.vatRateBp,
          pricesIncludeVat: branch.pricesIncludeVat,
        },
      }).grandTotal,
    formatMoney(detail?.bill.grandTotal ?? 0, branch.currency),
  );
  check(
    "นับของที่ยังไม่ได้เสิร์ฟไว้เตือนพนักงาน",
    detail?.unservedCount === 3,
    `ได้ ${detail?.unservedCount}`,
  );

  // สั่งรอบสอง แล้วยอดต้องรวมทั้งสองรอบเป็นบิลใบเดียว
  await addToCart({ ...cartLine, menuItemId: WATER, quantity: 2, modifierIds: [] });
  await placeOrder(session.id);

  const detail2 = await getTableBill(branch.id, BILL_TABLE_ID);
  check(
    "สั่งเพิ่มอีกรอบ = บิลใบเดิมยอดโตขึ้น ไม่ใช่บิลใบที่สอง",
    detail2?.bill.subtotal === 18_000,
    `ได้ ${detail2?.bill.subtotal}`,
  );
  check("บรรทัดแยกตามรอบที่สั่ง ไม่ยุบรวมกัน", detail2?.lines.length === 3);

  // -- 8. Expired round that still owes money -------------------------------
  /**
   * expiresAt is a guard for the CUSTOMER only (it stops "photograph the QR,
   * order from home tomorrow"). It must never hide money the staff still has
   * to collect.
   *
   * Real case this came from: a round expired at 04:31 with a READY item
   * sitting on the kitchen screen. The table map showed the table free, the
   * billing screen said there was no bill, and closeTableSession() refused
   * because orders had already gone to the kitchen -- so the ticket was
   * stranded on KDS with no way to ever clear it.
   */
  await prisma.tableSession.update({
    where: { id: session.id },
    data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
  });

  const expiredBill = await getTableBill(branch.id, BILL_TABLE_ID);
  check(
    "expired round is still billable",
    expiredBill?.session?.id === session.id,
    `got ${expiredBill?.session?.id ?? "null"}`,
  );
  check(
    "expired round keeps its full amount",
    expiredBill?.bill.subtotal === 18_000,
    `got ${expiredBill?.bill.subtotal}`,
  );

  const expiredDetail = await getPosTable(branch.id, BILL_TABLE_ID);
  check(
    "expired round still opens on the POS table screen",
    expiredDetail?.session?.id === session.id,
    `got ${expiredDetail?.session?.id ?? "null"}`,
  );

  const map = await getPosTables(branch.id);
  const mapRow = map.find((row) => row.id === BILL_TABLE_ID);
  check(
    "table map still shows the table as occupied",
    mapRow?.session?.id === session.id,
    `got ${mapRow?.session?.id ?? "null"}`,
  );

  /**
   * The other half of the fix: the customer-side door must stay shut.
   * If this ever flips to PASS-by-resolving, the QR-screenshot hole is back.
   */
  const customerView = await resolveSessionByToken(branch.id, session.token);
  check(
    "customer QR token is still rejected once expired",
    customerView === null,
    customerView ? "resolved when it should not" : "",
  );

  await resetTable(BILL_TABLE_ID);
  console.log("cleanup done");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
