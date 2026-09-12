import "server-only";

import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import type { ReportRange } from "@/lib/report-range";
import { branchDayRangeUtc } from "@/lib/server/branch-time";
import { prisma } from "@/lib/server/db";

/**
 * รายงานยอดขายย้อนหลัง (spec §18)
 *
 * ── ยอดเงินมาจาก `Payment` เท่านั้น ──────────────────────────────────────
 * กฎตั้งแต่บทที่ 11: ยอดในคอลัมน์ของ `Order` เป็น **ส่วนแบ่ง** ที่กระจายไว้
 * ทำรายงานแยกช่องทาง ไม่ใช่เงินที่ลูกค้าจ่ายจริง
 *
 * ── จำนวนชิ้นนับเฉพาะบิลที่จ่ายแล้วในช่วงนั้น ────────────────────────────
 * **ต่างจากหน้า "สรุปวันนี้" โดยตั้งใจ** ซึ่งนับของที่ส่งเข้าครัวแล้ว เพราะมันตอบ
 * คำถาม "ตอนนี้ครัวทำอะไรไปแล้วบ้าง" ส่วนรายงานย้อนหลังตอบ "ช่วงนั้นขายอะไรไป
 * แล้วได้เงินเท่าไร" — ถ้านับของที่ยังไม่จ่าย ตารางเมนูกับยอดรายได้จะบวกไม่ตรงกัน
 * แล้วทั้งหน้าเชื่อไม่ได้
 *
 * ── ไฟล์นี้ไม่แปลภาษา ──────────────────────────────────────────────────
 * คืนตัวเลขกับชื่อที่ snapshot ไว้เท่านั้น ป้ายทุกอันเป็นหน้าที่ของหน้าจอ
 */

/** ต้องมีบรรทัดเสมอแม้ยอดเป็นศูนย์ — คนอ่านต้องเห็นว่า "ไม่มี" ไม่ใช่ "หาไม่เจอ" */
const REPORTED_METHODS: readonly PaymentMethod[] = ["CASH", "QR", "CARD"];

export type SalesReport = {
  revenue: number;
  billCount: number;
  averageBill: number;
  itemsSold: number;
  byDay: Array<{ day: string; revenue: number; billCount: number }>;
  byHour: Array<{ hour: number; revenue: number; billCount: number }>;
  byMethod: Array<{ method: PaymentMethod; total: number; count: number }>;
  byStaff: Array<{
    staffId: string | null;
    name: string | null;
    total: number;
    count: number;
    discountTotal: number;
  }>;
  byItem: Array<{ menuItemId: string; name: string; quantity: number; revenue: number }>;
};

export async function getSalesReport(
  branchId: string,
  range: ReportRange,
  timezone: string,
): Promise<SalesReport> {
  const window = branchDayRangeUtc(range.fromDay, range.toDay, timezone);

  if (!window?.gte || !window.lt) {
    // resolveReportRange() ตรวจรูปแบบมาแล้ว มาถึงตรงนี้ไม่ได้ในทางปฏิบัติ
    throw new Error(`ช่วงวันที่ใช้ไม่ได้: ${range.fromDay}..${range.toDay}`);
  }

  const payments = await prisma.payment.findMany({
    where: { branchId, paidAt: { gte: window.gte, lt: window.lt } },
    select: {
      method: true,
      grandTotal: true,
      discountAmount: true,
      paidAt: true,
      paidByStaffId: true,
      paidByStaff: { select: { name: true } },
      tableSessionId: true,
    },
  });

  const revenue = payments.reduce((sum, row) => sum + row.grandTotal, 0);
  const billCount = payments.length;

  return {
    revenue,
    billCount,
    // หารเมื่อมีบิลเท่านั้น — ไม่งั้นได้ NaN แล้วหน้าจอขึ้นคำว่า NaN ให้เจ้าของร้านอ่าน
    averageBill: billCount > 0 ? Math.floor(revenue / billCount) : 0,
    ...(await itemTotals(
      branchId,
      payments.map((row) => row.tableSessionId),
    )),
    byDay: bucketByDay(payments, timezone, range),
    byHour: bucketByHour(payments, timezone),
    byMethod: groupByMethod(payments),
    byStaff: groupByStaff(payments),
  };
}

function groupByMethod(
  payments: Array<{ method: PaymentMethod; grandTotal: number }>,
): SalesReport["byMethod"] {
  return REPORTED_METHODS.map((method) => {
    const rows = payments.filter((row) => row.method === method);
    return {
      method,
      count: rows.length,
      total: rows.reduce((sum, row) => sum + row.grandTotal, 0),
    };
  });
}

/**
 * แยกตามคน **รับเงิน** (`paidByStaffId`) ไม่ใช่คนกดสั่ง
 *
 * `paidByStaffId` เป็น null ได้ (SetNull ตอนลบพนักงาน) — ต้องมีแถว "ไม่ระบุ"
 * ไม่ใช่ทิ้งแถวนั้นหาย ไม่งั้นผลรวมของตารางนี้จะน้อยกว่ารายได้จริงโดยไม่มีใครเห็น
 */
function groupByStaff(
  payments: Array<{
    grandTotal: number;
    discountAmount: number;
    paidByStaffId: string | null;
    paidByStaff: { name: string } | null;
  }>,
): SalesReport["byStaff"] {
  const buckets = new Map<string, SalesReport["byStaff"][number]>();

  for (const row of payments) {
    const key = row.paidByStaffId ?? "";
    const bucket = buckets.get(key) ?? {
      staffId: row.paidByStaffId,
      name: row.paidByStaff?.name ?? null,
      total: 0,
      count: 0,
      discountTotal: 0,
    };

    bucket.total += row.grandTotal;
    bucket.count += 1;
    bucket.discountTotal += row.discountAmount;
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((a, b) => b.total - a.total);
}

/**
 * จัดกลุ่มตามวันของสาขา — ทำใน JS ไม่ใช่ `date_trunc` ของ Postgres
 *
 * เขตเวลาของสาขาเป็นข้อมูลในแอป (`Branch.timezone`) การ group ใน SQL ต้องส่งชื่อ
 * โซนเข้าไปแล้วหวังว่า tzdata ของ container ตรงกับของ Node — **สองแหล่งความจริง**
 *
 * เติมวันที่ไม่มียอดให้เป็น 0 ด้วย เพราะกราฟแท่งที่ข้ามวันที่ร้านปิดจะอ่านผิด
 * (ดูเหมือนขายทุกวันทั้งที่หยุดไปหนึ่งวัน)
 */
function bucketByDay(
  payments: Array<{ paidAt: Date; grandTotal: number }>,
  timezone: string,
  range: ReportRange,
): SalesReport["byDay"] {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  const totals = new Map<string, { revenue: number; billCount: number }>();

  for (const row of payments) {
    const day = format.format(row.paidAt);
    const bucket = totals.get(day) ?? { revenue: 0, billCount: 0 };
    bucket.revenue += row.grandTotal;
    bucket.billCount += 1;
    totals.set(day, bucket);
  }

  const days: SalesReport["byDay"] = [];
  const dayMs = 24 * 60 * 60 * 1000;

  for (
    let at = Date.parse(`${range.fromDay}T00:00:00Z`);
    at <= Date.parse(`${range.toDay}T00:00:00Z`);
    at += dayMs
  ) {
    const day = new Date(at).toISOString().slice(0, 10);
    days.push({ day, ...(totals.get(day) ?? { revenue: 0, billCount: 0 }) });
  }

  return days;
}

/** 24 ช่องเสมอ — ชั่วโมงที่ไม่มียอดต้องเห็นว่าเป็นศูนย์ ไม่ใช่หายไปจากแกน */
function bucketByHour(
  payments: Array<{ paidAt: Date; grandTotal: number }>,
  timezone: string,
): SalesReport["byHour"] {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  });

  const hours: SalesReport["byHour"] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    revenue: 0,
    billCount: 0,
  }));

  for (const row of payments) {
    const hour = Number(format.format(row.paidAt)) % 24;
    hours[hour].revenue += row.grandTotal;
    hours[hour].billCount += 1;
  }

  return hours;
}

/**
 * จำนวนชิ้นและยอดต่อเมนู จากรายการของบิลที่จ่ายแล้วในช่วงนั้น
 *
 * ใช้ `nameSnapshot` เป็นชื่อที่แสดง ไม่ join เมนูสด — ร้านเปลี่ยนชื่อเมนูแล้ว
 * รายงานเดือนที่แล้วต้องยังเรียกชื่อเดิม (กฎเดียวกับใบเสร็จบทที่ 12)
 * และเมื่อ id เดียวมีหลายชื่อในช่วงเดียวกัน **ใช้ชื่อของรายการที่ใหม่ที่สุด**
 * ไม่ใช่ตัวแรกที่เจอ ซึ่งขึ้นกับลำดับที่ฐานคืนมาแล้วเปลี่ยนไปมาได้
 */
async function itemTotals(
  branchId: string,
  sessionIds: string[],
): Promise<{ itemsSold: number; byItem: SalesReport["byItem"] }> {
  if (sessionIds.length === 0) {
    return { itemsSold: 0, byItem: [] };
  }

  const items = await prisma.orderItem.findMany({
    where: {
      branchId,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      order: { tableSessionId: { in: sessionIds } },
    },
    select: {
      menuItemId: true,
      nameSnapshot: true,
      quantity: true,
      lineTotal: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const buckets = new Map<string, SalesReport["byItem"][number]>();
  let itemsSold = 0;

  for (const item of items) {
    itemsSold += item.quantity;

    const bucket = buckets.get(item.menuItemId) ?? {
      menuItemId: item.menuItemId,
      name: item.nameSnapshot,
      quantity: 0,
      revenue: 0,
    };

    // เรียงจากเก่าไปใหม่ ตัวหลังสุดจึงเป็นชื่อล่าสุดเสมอ
    bucket.name = item.nameSnapshot;
    bucket.quantity += item.quantity;
    bucket.revenue += item.lineTotal;
    buckets.set(item.menuItemId, bucket);
  }

  return {
    itemsSold,
    // เรียงมากไปน้อย — "ขายไม่ออก" คือหางของลิสต์เดียวกัน ไม่ต้องมี query ที่สอง
    byItem: [...buckets.values()].sort((a, b) => b.quantity - a.quantity),
  };
}
