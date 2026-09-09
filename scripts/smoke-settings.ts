import "dotenv/config";

import { canEditSettings, canEditTaxSettings } from "@/lib/rbac";
import { getTableBill } from "@/lib/server/billing";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import { takePayment } from "@/lib/server/payment";
import { openTableByStaff } from "@/lib/server/pos";
import {
  deleteStation,
  getSettings,
  updateBusinessInfo,
  updateTaxSettings,
  upsertStation,
} from "@/lib/server/settings";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * Smoke test ของหน้าตั้งค่า (spec §22 §23 §24)
 *
 *     npm run smoke:settings
 *
 * ── สิ่งที่ต้องพิสูจน์ ────────────────────────────────────────────────────
 *   1. **แก้อัตราแล้วบิลที่ปิดไปแล้วต้องไม่ขยับแม้แต่บาทเดียว** — ทั้งระบบพึ่ง
 *      snapshot ใน `Payment`/`Receipt` ข้อนี้คือข้อพิสูจน์ว่ามันทำงานจริง
 *   2. **เปลี่ยนสกุลเงินหลังเคยรับเงินแล้วต้องทำไม่ได้** — เลข 6000 ที่เคยแปลว่า
 *      ฿60.00 จะกลายเป็น ₭6,000 ทันที = ประวัติการเงินถูกตีความใหม่ทั้งร้าน
 *   3. **แคชเชียร์/ผู้จัดการแตะอัตราภาษีไม่ได้** (เจ้าของร้านเท่านั้น)
 *
 * ใช้โต๊ะ B2 กับสถานีทดสอบรหัส `T9*` แล้วคืนค่าตั้งเดิมของสาขาทุกครั้งใน finally
 * — สคริปต์นี้แก้ค่าระดับสาขาจริง ถ้าไม่คืนค่า smoke ชุดอื่นจะคิดเงินผิดทั้งหมด
 */

const TABLE_CODE = "b2r3cy";
const STATION_CODE = "T9ST";

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

async function main() {
  const owner = (await prisma.staff.findFirstOrThrow({
    where: { code: "001" },
    include: { branch: true },
  })) as CurrentStaff;
  const cashier = (await prisma.staff.findFirstOrThrow({
    where: { code: "002" },
    include: { branch: true },
  })) as CurrentStaff;
  const branchId = owner.branchId;

  const original = await prisma.branch.findUniqueOrThrow({
    where: { id: branchId },
    include: { tenant: true },
  });

  try {
    console.log("── 1. สิทธิ์ (ตรรกะบริสุทธิ์) ────────────────────────────────────\n");

    check("เจ้าของร้านแก้ข้อมูลร้านได้", canEditSettings("OWNER") === true);
    check("ผู้จัดการแก้ข้อมูลร้านได้", canEditSettings("MANAGER") === true);
    check("แคชเชียร์แก้ข้อมูลร้านไม่ได้", canEditSettings("CASHIER") === false);
    check("เจ้าของร้านแก้อัตราภาษีได้", canEditTaxSettings("OWNER") === true);
    check(
      "ผู้จัดการแก้อัตราภาษีไม่ได้ (คนละสิทธิ์กับข้อมูลร้าน)",
      canEditTaxSettings("MANAGER") === false,
    );

    console.log("\n── 2. อ่านค่าตั้งปัจจุบัน ────────────────────────────────────────\n");

    const settings = await getSettings(branchId);
    check("อ่านค่าตั้งของสาขาได้", settings !== null);
    check("มีข้อมูลกิจการ (Tenant) มาด้วย", settings?.tenant.id === original.tenantId);
    check("มีรายการสถานีครัวมาด้วย", (settings?.stations.length ?? 0) > 0, `${settings?.stations.length} สถานี`);
    check(
      "บอกจำนวนบิลที่เคยรับเงิน (ใช้ตัดสินว่าจะให้แก้สกุลเงินไหม)",
      typeof settings?.paymentCount === "number",
      String(settings?.paymentCount),
    );

    console.log("\n── 3. อัตราภาษี/ค่าบริการ ────────────────────────────────────────\n");

    const byCashier = await updateTaxSettings(cashier, {
      vatRateBp: 700,
      serviceChargeBp: 0,
      staffMealDiscountBp: 1000,
      pricesIncludeVat: true,
      currency: original.currency,
      timezone: original.timezone,
    });
    check("แคชเชียร์แก้อัตราไม่ได้", byCashier.ok === false, byCashier.ok ? "" : byCashier.errorKey);

    const badRate = await updateTaxSettings(owner, {
      vatRateBp: 12000,
      serviceChargeBp: original.serviceChargeBp,
      staffMealDiscountBp: original.staffMealDiscountBp,
      pricesIncludeVat: original.pricesIncludeVat,
      currency: original.currency,
      timezone: original.timezone,
    });
    check("อัตราเกิน 100% = ปฏิเสธ", badRate.ok === false, badRate.ok ? "" : badRate.errorKey);

    const floatRate = await updateTaxSettings(owner, {
      vatRateBp: 700.5,
      serviceChargeBp: original.serviceChargeBp,
      staffMealDiscountBp: original.staffMealDiscountBp,
      pricesIncludeVat: original.pricesIncludeVat,
      currency: original.currency,
      timezone: original.timezone,
    });
    check("อัตราที่เป็นทศนิยม = ปฏิเสธ (กฎเรื่องเงินของทั้งโปรเจกต์)", floatRate.ok === false);

    const badTimezone = await updateTaxSettings(owner, {
      vatRateBp: original.vatRateBp,
      serviceChargeBp: original.serviceChargeBp,
      staffMealDiscountBp: original.staffMealDiscountBp,
      pricesIncludeVat: original.pricesIncludeVat,
      currency: original.currency,
      timezone: "Mars/Olympus",
    });
    check("timezone ที่ Node ไม่รู้จัก = ปฏิเสธ", badTimezone.ok === false, badTimezone.ok ? "" : badTimezone.errorKey);

    console.log("\n── 4. บิลที่ปิดไปแล้วต้องไม่ขยับตามอัตราใหม่ ────────────────────\n");

    const table = await prisma.restaurantTable.findFirstOrThrow({
      where: { tableCode: TABLE_CODE },
      include: { branch: true },
    });

    // ล้างของค้างจากรอบก่อน ตามลำดับ ออร์เดอร์ → ใบเสร็จ → การรับเงิน → รอบโต๊ะ
    const stale = await prisma.tableSession.findMany({ where: { tableId: table.id } });
    for (const session of stale) {
      await prisma.order.deleteMany({ where: { tableSessionId: session.id } });
      const payments = await prisma.payment.findMany({ where: { tableSessionId: session.id } });
      await prisma.receipt.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
      await prisma.payment.deleteMany({ where: { tableSessionId: session.id } });
    }
    await prisma.tableSession.deleteMany({ where: { tableId: table.id } });

    const opened = await openTableByStaff(owner, table.id, 2);
    if (!opened.ok) throw new Error(opened.errorKey);

    const added = await addToCart({
      tableSessionId: opened.session.id,
      branchId,
      tableId: table.id,
      timezone: table.branch.timezone,
      menuItemId: "seed-item-krapao",
      quantity: 2,
      modifierIds: ["seed-mod-size-regular", "seed-mod-spice-mild"],
      note: null,
      channel: "POS",
    });
    if (!added.ok) throw new Error(added.errorKey);
    await placeOrder(opened.session.id);

    const beforeBill = await getTableBill(branchId, table.id);
    const paid = await takePayment(owner, table.id, {
      method: "CASH",
      receivedAmount: beforeBill && !beforeBill.isEmpty ? beforeBill.bill.grandTotal : 0,
    });
    if (!paid.ok) throw new Error(paid.errorKey);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paid.paymentId } });

    // ขึ้น VAT เป็น 10% และเซอร์วิสชาร์จเป็น 20% หลังจากที่บิลปิดไปแล้ว
    const raised = await updateTaxSettings(owner, {
      vatRateBp: 1000,
      serviceChargeBp: 2000,
      staffMealDiscountBp: original.staffMealDiscountBp,
      pricesIncludeVat: original.pricesIncludeVat,
      currency: original.currency,
      timezone: original.timezone,
    });
    check("เจ้าของร้านขึ้นอัตราได้", raised.ok === true, raised.ok ? "" : raised.errorKey);

    const afterPayment = await prisma.payment.findUniqueOrThrow({ where: { id: paid.paymentId } });
    check(
      "ยอดที่ลูกค้าจ่ายไปแล้วไม่เปลี่ยน",
      afterPayment.grandTotal === payment.grandTotal,
      `${payment.grandTotal} → ${afterPayment.grandTotal}`,
    );
    check(
      "อัตราที่ติดอยู่กับบิลเก่าไม่เปลี่ยนตามค่าตั้งใหม่",
      afterPayment.vatRateBp === payment.vatRateBp &&
        afterPayment.serviceChargeBp === payment.serviceChargeBp,
      `vat ${afterPayment.vatRateBp} · service ${afterPayment.serviceChargeBp}`,
    );

    const receipt = await prisma.receipt.findFirstOrThrow({ where: { paymentId: paid.paymentId } });
    check(
      "ใบเสร็จยัง snapshot ชื่อร้าน ณ วันที่ออกใบไว้เหมือนเดิม",
      receipt.sellerName === original.tenant.name,
      receipt.sellerName,
    );

    /** บิลใบถัดไปต้องใช้อัตราใหม่ — ไม่งั้นการตั้งค่าไม่มีผลอะไรเลย */
    const opened2 = await openTableByStaff(owner, table.id, 2);
    if (!opened2.ok) throw new Error(opened2.errorKey);
    await addToCart({
      tableSessionId: opened2.session.id,
      branchId,
      tableId: table.id,
      timezone: table.branch.timezone,
      menuItemId: "seed-item-krapao",
      quantity: 2,
      modifierIds: ["seed-mod-size-regular", "seed-mod-spice-mild"],
      note: null,
      channel: "POS",
    });
    await placeOrder(opened2.session.id);

    const newBill = await getTableBill(branchId, table.id);
    check(
      "บิลใบใหม่ใช้เซอร์วิสชาร์จอัตราใหม่ทันที",
      newBill !== null && !newBill.isEmpty && newBill.bill.serviceChargeBp === 2000,
      newBill && !newBill.isEmpty ? String(newBill.bill.serviceChargeBp) : "",
    );
    check(
      "บิลใบใหม่แพงกว่าใบเก่าของชุดเดียวกัน (อัตราใหม่มีผลจริง)",
      newBill !== null && !newBill.isEmpty && newBill.bill.grandTotal > payment.grandTotal,
      newBill && !newBill.isEmpty ? `${payment.grandTotal} → ${newBill.bill.grandTotal}` : "",
    );

    console.log("\n── 5. สกุลเงินเปลี่ยนไม่ได้ถ้าเคยรับเงินแล้ว ────────────────────\n");

    const switchCurrency = await updateTaxSettings(owner, {
      vatRateBp: original.vatRateBp,
      serviceChargeBp: original.serviceChargeBp,
      staffMealDiscountBp: original.staffMealDiscountBp,
      pricesIncludeVat: original.pricesIncludeVat,
      currency: original.currency === "THB" ? "LAK" : "THB",
      timezone: original.timezone,
    });
    check(
      "สลับสกุลเงินหลังเคยรับเงินแล้ว = ปฏิเสธ",
      switchCurrency.ok === false,
      switchCurrency.ok ? "เปลี่ยนได้ ซึ่งไม่ควรได้" : switchCurrency.errorKey,
    );
    check(
      "สกุลเงินของสาขายังเป็นค่าเดิม",
      (await prisma.branch.findUniqueOrThrow({ where: { id: branchId } })).currency ===
        original.currency,
    );

    console.log("\n── 6. ข้อมูลร้านบนใบเสร็จ ────────────────────────────────────────\n");

    const badTaxId = await updateBusinessInfo(owner, {
      tenantName: original.tenant.name,
      taxId: "12345",
      branchName: original.name,
      addressLine: original.addressLine ?? "",
      phone: original.phone ?? "",
      receiptFooter: "",
    });
    check("เลขผู้เสียภาษีไม่ครบ 13 หลัก = ปฏิเสธ", badTaxId.ok === false, badTaxId.ok ? "" : badTaxId.errorKey);

    const emptyName = await updateBusinessInfo(owner, {
      tenantName: "   ",
      taxId: "",
      branchName: original.name,
      addressLine: "",
      phone: "",
      receiptFooter: "",
    });
    check("ชื่อกิจการว่าง = ปฏิเสธ", emptyName.ok === false, emptyName.ok ? "" : emptyName.errorKey);

    const updatedInfo = await updateBusinessInfo(owner, {
      tenantName: "ร้านทดสอบตั้งค่า",
      taxId: "0-1055-61000-00-0",
      branchName: original.name,
      addressLine: "123 ถนนทดสอบ",
      phone: "02-111-2222",
      receiptFooter: "ขอบคุณครับ · Wi-Fi: posdemo",
    });
    check("แก้ข้อมูลร้านได้", updatedInfo.ok === true, updatedInfo.ok ? "" : updatedInfo.errorKey);

    const afterInfo = await prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      include: { tenant: true },
    });
    check(
      "เลขผู้เสียภาษีถูกตัดขีดออกก่อนเก็บ",
      afterInfo.tenant.taxId === "0105561000000",
      String(afterInfo.tenant.taxId),
    );
    check("ข้อความท้ายใบถูกเก็บ", afterInfo.receiptFooter === "ขอบคุณครับ · Wi-Fi: posdemo");
    check(
      "ใบเสร็จที่ออกไปก่อนหน้ายัง snapshot ชื่อเดิมไว้ ไม่เปลี่ยนตาม",
      (await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).sellerName ===
        original.tenant.name,
    );

    /** ใบที่ออกหลังตั้งค่าต้องได้ข้อความท้ายใบใหม่ติดไปด้วย */
    const bill2 = await getTableBill(branchId, table.id);
    const paid2 = await takePayment(owner, table.id, {
      method: "CASH",
      receivedAmount: bill2 && !bill2.isEmpty ? bill2.bill.grandTotal : 0,
    });
    if (!paid2.ok) throw new Error(paid2.errorKey);

    const receipt2 = await prisma.receipt.findFirstOrThrow({ where: { paymentId: paid2.paymentId } });
    check(
      "ใบที่ออกหลังตั้งค่า snapshot ข้อความท้ายใบใหม่",
      receipt2.sellerFooter === "ขอบคุณครับ · Wi-Fi: posdemo",
      String(receipt2.sellerFooter),
    );
    check(
      "ใบเก่าไม่มีข้อความท้ายใบ (ออกก่อนมีคอลัมน์นี้) และต้องไม่พังตอนแสดงผล",
      receipt.sellerFooter === null,
    );

    console.log("\n── 7. สถานีครัว ──────────────────────────────────────────────────\n");

    await prisma.station.deleteMany({ where: { branchId, code: STATION_CODE } });

    const created = await upsertStation(owner, null, {
      code: STATION_CODE.toLowerCase(),
      name: "สถานีทดสอบ",
      sortOrder: 99,
      isActive: true,
    });
    check("สร้างสถานีใหม่ได้", created.ok === true, created.ok ? "" : created.errorKey);

    const stationRow = await prisma.station.findFirstOrThrow({
      where: { branchId, code: STATION_CODE },
    });
    check("รหัสสถานีถูกทำเป็นตัวใหญ่ให้เอง", stationRow.code === STATION_CODE, stationRow.code);

    const duplicate = await upsertStation(owner, null, {
      code: STATION_CODE,
      name: "ซ้ำ",
      sortOrder: 1,
      isActive: true,
    });
    check("รหัสสถานีซ้ำในสาขาเดียวกัน = ปฏิเสธ", duplicate.ok === false, duplicate.ok ? "" : duplicate.errorKey);

    const renamed = await upsertStation(owner, stationRow.id, {
      code: STATION_CODE,
      name: "สถานีทดสอบ (แก้ชื่อ)",
      sortOrder: 5,
      isActive: false,
    });
    check("แก้ชื่อ/ลำดับ/ปิดใช้งานสถานีได้", renamed.ok === true, renamed.ok ? "" : renamed.errorKey);

    const byCashierStation = await upsertStation(cashier, null, {
      code: "T9XX",
      name: "โดยแคชเชียร์",
      sortOrder: 1,
      isActive: true,
    });
    check("แคชเชียร์แก้สถานีไม่ได้", byCashierStation.ok === false);

    const removed = await deleteStation(owner, stationRow.id);
    check("ลบสถานีที่ไม่เคยถูกใช้ได้", removed.ok === true, removed.ok ? "" : removed.errorKey);

    const usedStation = await prisma.station.findFirstOrThrow({
      where: { branchId, code: { not: STATION_CODE } },
    });
    const blocked = await deleteStation(owner, usedStation.id);
    check(
      "ลบสถานีที่มีเมนู/ออร์เดอร์ผูกอยู่ไม่ได้ (ให้ปิดใช้งานแทน)",
      blocked.ok === false,
      blocked.ok ? "ลบได้ ซึ่งไม่ควรได้" : blocked.errorKey,
    );

    console.log("\n── 8. AuditLog ───────────────────────────────────────────────────\n");

    const logs = await prisma.auditLog.findMany({
      where: { branchId, entityType: "settings" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    check("เขียน log ทุกครั้งที่แก้ค่าตั้ง", logs.length > 0, `${logs.length} รายการ`);
    check(
      "log เก็บค่าก่อน-หลังไว้ทั้งคู่",
      logs.every((log) => JSON.stringify(log.metadata).includes("before") &&
        JSON.stringify(log.metadata).includes("after")),
    );
    check(
      "แยก action ของอัตราภาษีกับข้อมูลร้านออกจากกัน",
      logs.some((log) => log.action === "settings.tax_update") &&
        logs.some((log) => log.action === "settings.business_update"),
      [...new Set(logs.map((log) => log.action))].join(" · "),
    );
  } finally {
    console.log("\n── คืนค่าตั้งเดิมของสาขา ─────────────────────────────────────────\n");

    await prisma.branch.update({
      where: { id: branchId },
      data: {
        name: original.name,
        vatRateBp: original.vatRateBp,
        serviceChargeBp: original.serviceChargeBp,
        staffMealDiscountBp: original.staffMealDiscountBp,
        pricesIncludeVat: original.pricesIncludeVat,
        currency: original.currency,
        timezone: original.timezone,
        addressLine: original.addressLine,
        phone: original.phone,
        receiptFooter: original.receiptFooter,
      },
    });
    await prisma.tenant.update({
      where: { id: original.tenantId },
      data: { name: original.tenant.name, taxId: original.tenant.taxId },
    });
    await prisma.station.deleteMany({ where: { branchId, code: { startsWith: "T9" } } });
    await prisma.auditLog.deleteMany({ where: { branchId, entityType: "settings" } });

    const table = await prisma.restaurantTable.findFirst({ where: { tableCode: TABLE_CODE } });
    if (table) {
      const sessions = await prisma.tableSession.findMany({ where: { tableId: table.id } });
      for (const session of sessions) {
        await prisma.order.deleteMany({ where: { tableSessionId: session.id } });
        const payments = await prisma.payment.findMany({ where: { tableSessionId: session.id } });
        await prisma.receipt.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
        await prisma.payment.deleteMany({ where: { tableSessionId: session.id } });
      }
      await prisma.tableSession.deleteMany({ where: { tableId: table.id } });
      await prisma.restaurantTable.update({
        where: { id: table.id },
        data: { status: "AVAILABLE" },
      });
    }

    const restored = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    check(
      "คืนค่าอัตราเดิมของสาขาแล้ว (ไม่งั้น smoke ชุดอื่นจะคิดเงินผิดทั้งหมด)",
      restored.vatRateBp === original.vatRateBp &&
        restored.serviceChargeBp === original.serviceChargeBp,
      `vat ${restored.vatRateBp} · service ${restored.serviceChargeBp}`,
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
