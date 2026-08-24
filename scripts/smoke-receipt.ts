import "dotenv/config";

import type { Currency } from "@/lib/generated/prisma/enums";
import { formatMoney } from "@/lib/money";
import { canBrowseReceipts, canReprintReceipt } from "@/lib/rbac";
import {
  RECEIPT_KIND_TITLE,
  RECEIPT_SERIES,
  formatReceiptNumber,
  receiptKindForCurrency,
} from "@/lib/receipt";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import { takePayment } from "@/lib/server/payment";
import { getReceipt, listReceipts, recordReceiptPrint } from "@/lib/server/receipt";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { openOrJoinTableSession } from "@/lib/server/table-session";

/**
 * Smoke test ของใบเสร็จ / ใบกำกับภาษีอย่างย่อ (บทที่ 12)
 *
 *     npm run smoke:receipt
 *
 * ใช้โต๊ะ **B2** (และ B1 เฉพาะเคสกดพร้อมกันสองเครื่อง) — ชนกับ smoke:bill ได้
 * เพราะสคริปต์รันทีละตัวและล้างของตัวเองทุกครั้ง
 *
 * ── สิ่งที่ไฟล์นี้มีไว้พิสูจน์เป็นอันดับแรก ────────────────────────────────
 * **เลขที่เอกสารต่อเนื่อง ไม่ซ้ำ และไม่ขาด** — สามข้อนี้คือสิ่งเดียวที่ตรวจสอบ
 * ย้อนหลังไม่ผ่านแน่ ๆ ถ้าพลาด และเป็นสิ่งที่ทดสอบด้วยมือไม่ได้เลย
 * (ต้องยิงพร้อมกันจริง และต้องทำให้ transaction ล้มเหลวจริง)
 */

const TABLE_ID = "seed-table-b2";
const TABLE_ID_2 = "seed-table-b1";

const KRAPAO = "seed-item-krapao";
const KRAPAO_OPTIONS = ["seed-mod-spice-mild", "seed-mod-size-regular"];

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) passed++;
  else {
    failed++;
    process.exitCode = 1;
  }
}

async function loadStaff(id: string): Promise<CurrentStaff> {
  return prisma.staff.findUniqueOrThrow({ where: { id }, include: { branch: true } });
}

/**
 * ล้างโต๊ะ — ลำดับการลบสำคัญมากและยาวขึ้นอีกหนึ่งชั้นในบทที่ 12
 * ใบเสร็จ → ออร์เดอร์ → การรับเงิน → รอบโต๊ะ
 * (Receipt.paymentId, Order.paymentId และ Payment.tableSessionId เป็น Restrict ทั้งหมด)
 */
async function resetTable(tableId: string) {
  const sessions = await prisma.tableSession.findMany({
    where: { tableId },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);

  const paymentIds = (
    await prisma.payment.findMany({
      where: { tableSessionId: { in: sessionIds } },
      select: { id: true },
    })
  ).map((payment) => payment.id);

  const receiptIds = (
    await prisma.receipt.findMany({
      where: { paymentId: { in: paymentIds } },
      select: { id: true },
    })
  ).map((receipt) => receipt.id);

  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [...sessionIds, ...paymentIds, ...receiptIds] } },
  });
  await prisma.order.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.receipt.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.restaurantTable.update({ where: { id: tableId }, data: { status: "AVAILABLE" } });
}

/** เปิดโต๊ะ สั่งของหนึ่งบิล แล้วคืน sessionId */
async function seedOrder(tableId: string, branchId: string, timezone: string) {
  const session = await openOrJoinTableSession({ tableId, branchId, pax: 2 });

  await addToCart({
    tableSessionId: session.id,
    branchId,
    tableId,
    timezone,
    note: null,
    menuItemId: KRAPAO,
    quantity: 2,
    modifierIds: KRAPAO_OPTIONS,
  });
  await placeOrder(session.id);

  return session;
}

/** เลขลำดับล่าสุดที่ตัวเดินเลขของสาขานี้ออกไปแล้ว */
async function currentSeq(branchId: string): Promise<number> {
  const counter = await prisma.documentCounter.findUniqueOrThrow({
    where: { branchId_series: { branchId, series: RECEIPT_SERIES } },
    select: { lastSeq: true },
  });
  return counter.lastSeq;
}

async function main() {
  const branch = await prisma.branch.findFirstOrThrow();
  const owner = await loadStaff("seed-staff-owner");
  const cashier = await loadStaff("seed-staff-cashier");
  const server = await loadStaff("seed-staff-server");
  const kitchen = await loadStaff("seed-staff-kitchen");

  // ── 1. ฟังก์ชันบริสุทธิ์ใน lib/receipt.ts ────────────────────────────────
  check("เลขที่เติมศูนย์ครบ 8 หลัก", formatReceiptNumber("HQ", 1) === "HQ-00000001");
  check("เลขที่หลักเยอะยังถูก", formatReceiptNumber("BR-02", 123456) === "BR-02-00123456");
  check("THB ออกใบกำกับภาษีอย่างย่อ", receiptKindForCurrency("THB") === "TAX_ABB");
  check("LAK ออกใบเสร็จธรรมดา", receiptKindForCurrency("LAK") === "RECEIPT");
  check("VND ออกใบเสร็จธรรมดา", receiptKindForCurrency("VND") === "RECEIPT");
  check(
    "หัวเอกสารของ RECEIPT ต้องไม่มีคำว่าภาษี",
    !RECEIPT_KIND_TITLE.RECEIPT.includes("ภาษี"),
    RECEIPT_KIND_TITLE.RECEIPT,
  );
  check(
    "หัวเอกสารของ TAX_ABB ต้องมีคำว่าใบกำกับภาษี",
    RECEIPT_KIND_TITLE.TAX_ABB.includes("ใบกำกับภาษี"),
    RECEIPT_KIND_TITLE.TAX_ABB,
  );

  // ── 2. สิทธิ์ (ตารางล้วน ยังไม่แตะฐาน) ──────────────────────────────────
  check("เจ้าของพิมพ์ใบเสร็จได้", canReprintReceipt("OWNER"));
  check("ผู้จัดการพิมพ์ใบเสร็จได้", canReprintReceipt("MANAGER"));
  check("แคชเชียร์พิมพ์ใบเสร็จได้ (คนถือเงินคือคนออกหลักฐาน)", canReprintReceipt("CASHIER"));
  check("พนักงานเสิร์ฟพิมพ์ใบเสร็จไม่ได้", !canReprintReceipt("SERVER"));
  check("ครัวพิมพ์ใบเสร็จไม่ได้", !canReprintReceipt("KITCHEN"));
  check("เจ้าของเปิดลิสต์ย้อนหลังได้", canBrowseReceipts("OWNER"));
  check("ผู้จัดการเปิดลิสต์ย้อนหลังได้", canBrowseReceipts("MANAGER"));
  check(
    "แคชเชียร์เปิดลิสต์ย้อนหลังไม่ได้ (ลิสต์ = เห็นยอดขายทั้งสาขา)",
    !canBrowseReceipts("CASHIER"),
  );

  await resetTable(TABLE_ID);
  await resetTable(TABLE_ID_2);

  // ── 3. รับเงินหนึ่งครั้ง = ได้ใบเสร็จหนึ่งใบอัตโนมัติ ────────────────────
  const seqBefore = await currentSeq(branch.id);
  await seedOrder(TABLE_ID, branch.id, branch.timezone);
  const paid = await takePayment(cashier, TABLE_ID, { method: "QR" });
  check("รับเงินสำเร็จ", paid.ok, paid.ok ? paid.paymentId : paid.error);
  if (!paid.ok) throw new Error("รับเงินไม่สำเร็จ ทดสอบต่อไม่ได้");

  const issued = await prisma.receipt.findUniqueOrThrow({
    where: { paymentId: paid.paymentId },
  });

  check("ออกใบเสร็จให้อัตโนมัติโดยไม่ต้องกดอะไรเพิ่ม", Boolean(issued));
  check("เลขลำดับเดินไปหนึ่ง", issued.seq === seqBefore + 1, `${seqBefore} → ${issued.seq}`);
  check(
    "เลขที่บนใบตรงกับรหัสสาขา + ลำดับ",
    issued.number === formatReceiptNumber(branch.code, issued.seq),
    issued.number,
  );
  check("สาขา THB ได้ชนิด TAX_ABB", issued.kind === "TAX_ABB");
  check("ใบยังไม่เคยถูกพิมพ์", issued.printCount === 0 && issued.firstPrintedAt === null);
  check("ตัวเดินเลขขยับตาม", (await currentSeq(branch.id)) === issued.seq);

  // ── 4. snapshot ตัวตนผู้ขายลงใบ ไม่ใช่ join สด ──────────────────────────
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: branch.tenantId } });
  check("snapshot ชื่อร้าน", issued.sellerName === tenant.name, issued.sellerName);
  check("snapshot เลขผู้เสียภาษี", issued.sellerTaxId === tenant.taxId, issued.sellerTaxId ?? "-");
  check("snapshot ชื่อสาขา", issued.sellerBranchName === branch.name);
  check("snapshot ที่อยู่", issued.sellerAddress === branch.addressLine);
  check("snapshot เบอร์โทร", issued.sellerPhone === branch.phone);

  // ── 5. ยอดบนใบต้องมาจาก Payment ไม่ใช่ผลบวกของ Order ───────────────────
  const detail = await getReceipt(branch.id, issued.id);
  if (!detail) throw new Error("อ่านใบเสร็จที่เพิ่งออกไม่ได้");

  const orderSum = detail.payment.orders.reduce((sum, order) => sum + order.grandTotal, 0);
  check(
    "ยอดบนใบ = Payment.grandTotal",
    detail.payment.grandTotal === detail.payment.subtotal
      - detail.payment.discountAmount
      + detail.payment.serviceChargeAmount
      + (detail.payment.pricesIncludeVat ? 0 : detail.payment.vatAmount),
    formatMoney(detail.payment.grandTotal, detail.payment.currency),
  );
  check(
    "ผลบวกของ Order บังเอิญเท่ากันในเคสบิลใบเดียว แต่ใบเสร็จไม่ได้อ่านจากตรงนั้น",
    orderSum === detail.payment.grandTotal,
    `${orderSum} vs ${detail.payment.grandTotal}`,
  );
  check("netAmount + vat = grandTotal เสมอ", detail.payment.netAmount + detail.payment.vatAmount === detail.payment.grandTotal);
  check("ใบเสร็จมีบรรทัดสินค้าติดมาด้วย", detail.lines.length > 0, `${detail.lines.length} บรรทัด`);

  // ── 6. แก้ข้อมูลสาขาแล้วใบเดิมต้องไม่เปลี่ยนตาม ─────────────────────────
  const originalBranch = { name: branch.name, addressLine: branch.addressLine, vatRateBp: branch.vatRateBp };
  try {
    await prisma.branch.update({
      where: { id: branch.id },
      data: { name: "สาขาที่เปลี่ยนชื่อแล้ว", addressLine: "ที่อยู่ใหม่หลังย้ายร้าน", vatRateBp: 1000 },
    });

    const reread = await getReceipt(branch.id, issued.id);
    check(
      "เปลี่ยนชื่อสาขาแล้ว ใบเดิมยังเป็นชื่อเดิม",
      reread?.receipt.sellerBranchName === originalBranch.name,
      reread?.receipt.sellerBranchName ?? "-",
    );
    check(
      "ย้ายที่อยู่แล้ว ใบเดิมยังเป็นที่อยู่เดิม",
      reread?.receipt.sellerAddress === originalBranch.addressLine,
    );
    check(
      "ขึ้น VAT เป็น 10% แล้ว ใบเดิมยังเป็นอัตราเดิม",
      reread?.payment.vatRateBp === originalBranch.vatRateBp,
      `${reread?.payment.vatRateBp}`,
    );
  } finally {
    await prisma.branch.update({ where: { id: branch.id }, data: originalBranch });
  }

  // ── 7. อ่านใบของสาขาอื่น / ใบที่ไม่มี ต้องได้ null ไม่ใช่ throw ──────────
  check("ใบที่ไม่มีอยู่ = null", (await getReceipt(branch.id, "ไม่มีจริง")) === null);
  check("ใบของสาขาอื่น = null", (await getReceipt("branch-อื่น", issued.id)) === null);

  // ── 8. การพิมพ์: นับจากปุ่ม + ลง AuditLog ทุกครั้ง ───────────────────────
  const deniedServer = await recordReceiptPrint(server, issued.id);
  check("พนักงานเสิร์ฟกดพิมพ์ไม่ได้", !deniedServer.ok);
  const deniedKitchen = await recordReceiptPrint(kitchen, issued.id);
  check("ครัวกดพิมพ์ไม่ได้", !deniedKitchen.ok);
  check(
    "การกดที่ถูกปฏิเสธต้องไม่ขยับตัวนับ",
    (await prisma.receipt.findUniqueOrThrow({ where: { id: issued.id } })).printCount === 0,
  );

  const print1 = await recordReceiptPrint(cashier, issued.id);
  check("แคชเชียร์พิมพ์ครั้งแรกได้", print1.ok && print1.printCount === 1);

  const afterFirst = await prisma.receipt.findUniqueOrThrow({ where: { id: issued.id } });
  check("firstPrintedAt ถูกตั้งตอนพิมพ์ครั้งแรก", afterFirst.firstPrintedAt !== null);

  const print2 = await recordReceiptPrint(owner, issued.id);
  check("พิมพ์ครั้งที่สองได้ และนับเป็น 2", print2.ok && print2.printCount === 2);

  const afterSecond = await prisma.receipt.findUniqueOrThrow({ where: { id: issued.id } });
  check(
    "firstPrintedAt ต้องไม่ถูกเขียนทับตอนพิมพ์ซ้ำ",
    afterSecond.firstPrintedAt?.getTime() === afterFirst.firstPrintedAt?.getTime(),
  );
  check("lastPrintedAt ขยับตามการพิมพ์ครั้งล่าสุด", (afterSecond.lastPrintedAt?.getTime() ?? 0) >= (afterFirst.lastPrintedAt?.getTime() ?? 0));

  const printLogs = await prisma.auditLog.findMany({
    where: { action: "receipt.print", entityId: issued.id },
    orderBy: { createdAt: "asc" },
  });
  check("AuditLog เขียนครบทุกครั้งที่พิมพ์ รวมครั้งแรก", printLogs.length === 2, `${printLogs.length} แถว`);
  check(
    "ครั้งแรกไม่ใช่สำเนา ครั้งที่สองเป็นสำเนา",
    (printLogs[0]?.metadata as { isCopy?: boolean })?.isCopy === false &&
      (printLogs[1]?.metadata as { isCopy?: boolean })?.isCopy === true,
  );
  check(
    "AuditLog เก็บเลขที่ไว้ด้วย (ค้นย้อนหลังจากเลขบนใบได้)",
    (printLogs[0]?.metadata as { number?: string })?.number === issued.number,
  );

  // ── 9. เลขที่ไม่ขาดเป็นรูเมื่อ transaction ล้มเหลว ───────────────────────
  //
  // ทดสอบสมบัตินี้ตรง ๆ แทนที่จะหวังว่ามันจริง: ยิง issueReceipt() ด้วย paymentId
  // ที่ถูกใช้ไปแล้ว — counter จะถูก increment ก่อน แล้ว create จะชน unique
  // ทั้ง transaction ต้องถูกย้อน **รวมถึงเลขที่ที่กินไปแล้ว**
  const seqBeforeRollback = await currentSeq(branch.id);
  let rolledBack = false;
  try {
    const { issueReceipt } = await import("@/lib/server/receipt-issue");
    await prisma.$transaction(async (tx) => {
      await issueReceipt(tx, {
        branchId: branch.id,
        paymentId: paid.paymentId, // ใบนี้มีใบเสร็จแล้ว → ชน unique แน่นอน
        currency: branch.currency,
        seller: {
          branchCode: branch.code,
          branchName: branch.name,
          tenantName: tenant.name,
          taxId: tenant.taxId,
          addressLine: branch.addressLine,
          phone: branch.phone,
        },
        issuedAt: new Date(),
      });
    });
  } catch {
    rolledBack = true;
  }

  check("การออกใบที่ล้มเหลวต้อง throw", rolledBack);
  check(
    "เลขที่ต้องถูกคืนกลับ ไม่ขาดเป็นรู",
    (await currentSeq(branch.id)) === seqBeforeRollback,
    `${seqBeforeRollback} → ${await currentSeq(branch.id)}`,
  );

  // ── 10. เลขเดินต่อเนื่องข้ามหลายบิล ─────────────────────────────────────
  const seqSeries: number[] = [issued.seq];
  for (let round = 0; round < 2; round++) {
    await resetTable(TABLE_ID);
    await seedOrder(TABLE_ID, branch.id, branch.timezone);
    const result = await takePayment(cashier, TABLE_ID, { method: "CASH", receivedAmount: 100_000 });
    if (!result.ok) throw new Error(`รับเงินรอบ ${round} ไม่สำเร็จ: ${result.error}`);
    const next = await prisma.receipt.findUniqueOrThrow({ where: { paymentId: result.paymentId } });
    seqSeries.push(next.seq);
  }

  check(
    "เลขเดินทีละหนึ่งไม่ข้าม",
    seqSeries.every((seq, index) => index === 0 || seq === seqSeries[index - 1] + 1),
    seqSeries.join(" → "),
  );

  // ── 11. สองเครื่องกดรับเงินพร้อมกัน — ห้ามได้เลขซ้ำ ห้ามข้าม ─────────────
  await resetTable(TABLE_ID);
  await resetTable(TABLE_ID_2);
  await seedOrder(TABLE_ID, branch.id, branch.timezone);
  await seedOrder(TABLE_ID_2, branch.id, branch.timezone);

  const seqBeforeRace = await currentSeq(branch.id);
  const [raceA, raceB] = await Promise.all([
    takePayment(cashier, TABLE_ID, { method: "QR" }),
    takePayment(owner, TABLE_ID_2, { method: "QR" }),
  ]);

  check("ทั้งสองเครื่องรับเงินสำเร็จ", raceA.ok && raceB.ok);
  if (raceA.ok && raceB.ok) {
    const [recA, recB] = await Promise.all([
      prisma.receipt.findUniqueOrThrow({ where: { paymentId: raceA.paymentId } }),
      prisma.receipt.findUniqueOrThrow({ where: { paymentId: raceB.paymentId } }),
    ]);

    check("ได้เลขคนละใบ ไม่ซ้ำกัน", recA.seq !== recB.seq, `${recA.seq} vs ${recB.seq}`);
    check("เลขที่บนใบก็ต่างกัน", recA.number !== recB.number);
    check(
      "สองใบติดกันพอดี ไม่มีเลขหายระหว่างกลาง",
      Math.abs(recA.seq - recB.seq) === 1,
      `${recA.seq}, ${recB.seq}`,
    );
    check(
      "ตัวเดินเลขขยับไปสองพอดี",
      (await currentSeq(branch.id)) === seqBeforeRace + 2,
      `${seqBeforeRace} → ${await currentSeq(branch.id)}`,
    );
  }

  // ── 12. สาขาสกุลเงินเวียดนาม — ห้ามมีคำว่าภาษี ห้ามมีเลขผู้เสียภาษีไทย ───
  const originalCurrency: Currency = branch.currency;
  try {
    await prisma.branch.update({ where: { id: branch.id }, data: { currency: "VND" } });
    const vndBranch = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    const vndCashier = await loadStaff("seed-staff-cashier");

    await resetTable(TABLE_ID);
    await seedOrder(TABLE_ID, vndBranch.id, vndBranch.timezone);
    const vndPaid = await takePayment(vndCashier, TABLE_ID, { method: "QR" });
    check("รับเงินที่สาขา VND ได้", vndPaid.ok);

    if (vndPaid.ok) {
      const vndReceipt = await prisma.receipt.findUniqueOrThrow({
        where: { paymentId: vndPaid.paymentId },
      });
      check("สาขา VND ได้ชนิด RECEIPT ไม่ใช่ TAX_ABB", vndReceipt.kind === "RECEIPT");
      check(
        "ใบของสาขา VND ต้องไม่มีเลขผู้เสียภาษีไทยติดไปด้วย",
        vndReceipt.sellerTaxId === null,
        vndReceipt.sellerTaxId ?? "null",
      );
      check(
        "เลขที่ยังเดินสายเดียวกัน ไม่ได้แยกตามสกุลเงิน",
        vndReceipt.series === RECEIPT_SERIES,
      );

      const vndDetail = await getReceipt(branch.id, vndReceipt.id);
      check("ยอดบนใบ VND ใช้สกุล VND", vndDetail?.payment.currency === "VND");
      /**
       * VND คั่นหลักพันด้วย **จุด** และสัญลักษณ์อยู่ท้าย — "6.000 ₫" คือหกพันดอง
       * ไม่ใช่หกดองจุดศูนย์ (ดู lib/money.ts) เคสนี้จึงตรึงรูปแบบไว้ตรง ๆ
       * แทนที่จะเช็คว่า "ไม่มีจุด" ซึ่งเป็นความเข้าใจผิดคนละเรื่องกัน
       */
      check("VND คั่นหลักพันด้วยจุด สัญลักษณ์อยู่ท้าย", formatMoney(6_000, "VND") === "6.000 ₫", formatMoney(6_000, "VND"));
      check(
        "ยอดจริงบนใบ VND ไม่มีเศษทศนิยม (หน่วยย่อยที่สุดคือ 1 ₫)",
        Number.isInteger(vndDetail?.payment.grandTotal),
        formatMoney(vndDetail?.payment.grandTotal ?? 0, "VND"),
      );
    }
  } finally {
    await prisma.branch.update({ where: { id: branch.id }, data: { currency: originalCurrency } });
  }

  // ── 13. ลิสต์ย้อนหลัง /admin/receipts ───────────────────────────────────
  const deniedList = await listReceipts(cashier, {});
  check("แคชเชียร์เปิดลิสต์ย้อนหลังไม่ได้", !deniedList.ok);
  const deniedList2 = await listReceipts(kitchen, {});
  check("ครัวเปิดลิสต์ย้อนหลังไม่ได้", !deniedList2.ok);

  const all = await listReceipts(owner, {});
  check("เจ้าของเปิดลิสต์ได้", all.ok);
  if (!all.ok) throw new Error("ลิสต์ใบเสร็จอ่านไม่ได้");

  check("ลิสต์มีใบอยู่จริง", all.total > 0, `${all.total} ใบ`);
  check(
    "เรียงใหม่ไปเก่า",
    all.rows.every(
      (row, index) => index === 0 || row.issuedAt.getTime() <= all.rows[index - 1].issuedAt.getTime(),
    ),
  );
  check("ทุกแถวมีเลขที่", all.rows.every((row) => row.number.startsWith(`${branch.code}-`)));
  check("ทุกแถวมีชื่อโต๊ะ", all.rows.every((row) => row.tableName !== null));

  const byNumber = await listReceipts(owner, { q: all.rows[0].number });
  check(
    "ค้นด้วยเลขที่บนใบเจอใบเดียว",
    byNumber.ok && byNumber.total === 1 && byNumber.rows[0].id === all.rows[0].id,
  );

  const byNumberLower = await listReceipts(owner, { q: all.rows[0].number.toLowerCase() });
  check("ค้นด้วยตัวพิมพ์เล็กก็เจอ", byNumberLower.ok && byNumberLower.total === 1);

  const byTable = await listReceipts(owner, { q: "B2" });
  check("ค้นด้วยชื่อโต๊ะเจอ", byTable.ok && byTable.total > 0, byTable.ok ? `${byTable.total}` : "");

  const byMethod = await listReceipts(owner, { method: "CASH" });
  check(
    "กรองด้วยวิธีจ่ายได้",
    byMethod.ok && byMethod.rows.every((row) => row.method === "CASH"),
  );

  const nonsense = await listReceipts(owner, { q: "ไม่มีเลขนี้แน่นอน" });
  check("ค้นไม่เจอ = 0 แถว ไม่ใช่ error", nonsense.ok && nonsense.total === 0);

  // ── 14. ตัวกรองช่วงวันคิดตามเวลาของสาขา ไม่ใช่ UTC ─────────────────────
  //
  // เคสที่พังจริงถ้าใช้ new Date("YYYY-MM-DD") เฉย ๆ: สาขากรุงเทพ (+07:00)
  // จะตีความเป็น 07:00 ของวันนั้น แล้วบิลตั้งแต่เที่ยงคืนถึงเจ็ดโมงเช้าหายไปเงียบ ๆ
  const todayInBranchTz = new Intl.DateTimeFormat("en-CA", {
    timeZone: branch.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const today = await listReceipts(owner, { from: todayInBranchTz, to: todayInBranchTz });
  check(
    "กรองเฉพาะวันนี้ยังเห็นใบที่เพิ่งออก",
    today.ok && today.total > 0,
    today.ok ? `${today.total} ใบ` : "",
  );

  const future = await listReceipts(owner, { from: "2099-01-01" });
  check("กรองอนาคต = 0 แถว", future.ok && future.total === 0);

  const past = await listReceipts(owner, { to: "2000-01-01" });
  check("กรองอดีตไกล ๆ = 0 แถว", past.ok && past.total === 0);

  check("รูปแบบวันที่ผิดต้องไม่ทำให้พัง", (await listReceipts(owner, { from: "not-a-date" })).ok);

  // ── 15. แบ่งหน้า ────────────────────────────────────────────────────────
  const page1 = await listReceipts(owner, { page: 1 });
  const wayPastEnd = await listReceipts(owner, { page: 999 });
  check("หน้าที่ 1 มีข้อมูล", page1.ok && page1.rows.length > 0);
  check(
    "หน้าที่เกินท้ายสุด = ว่าง แต่ยังบอก total เดิม",
    wayPastEnd.ok && page1.ok && wayPastEnd.rows.length === 0 && wayPastEnd.total === page1.total,
  );
  check("page ติดลบถูกดันกลับเป็น 1", (await listReceipts(owner, { page: -5 })).ok);
  check(
    "pageCount อย่างน้อย 1 เสมอแม้ไม่มีข้อมูล",
    nonsense.ok && nonsense.pageCount === 1,
  );

  // ── ล้างของที่สร้างไว้ ───────────────────────────────────────────────────
  await resetTable(TABLE_ID);
  await resetTable(TABLE_ID_2);

  console.log(`\nรวม ${passed + failed} เคส · PASS ${passed} · FAIL ${failed}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
