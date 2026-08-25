import "server-only";

import type { Currency } from "@/lib/generated/prisma/enums";
import { CURRENCIES } from "@/lib/money";
import { canEditSettings, canEditTaxSettings } from "@/lib/rbac";
import { clientIp } from "@/lib/server/client-ip";
import { prisma } from "@/lib/server/db";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * ตั้งค่าสาขา / ข้อมูลร้าน / สถานีครัว (spec §22 §23 §24)
 *
 * ── ก่อนหน้านี้ทุกค่าที่นี่แก้ได้จาก DB เท่านั้น ─────────────────────────
 * `vatRateBp` `serviceChargeBp` `pricesIncludeVat` `currency` `timezone`
 * `staffMealDiscountBp` ถูกใช้งานจริงทั้งระบบมาตั้งแต่บทที่ 10-13 แต่เจ้าของร้าน
 * เปลี่ยนเองไม่ได้เลย — ร้านที่ขึ้น VAT หรือเลิกเก็บเซอร์วิสชาร์จต้องรอคนเขียนโค้ด
 *
 * ── กฎที่ไฟล์นี้บังคับ และเหตุผล ─────────────────────────────────────────
 * 1. **แก้อัตราแล้วบิลเก่าต้องไม่ขยับ** — ทุกบิลที่ปิดแล้ว snapshot อัตราไว้ใน
 *    `Payment` และใบเสร็จ snapshot ตัวตนผู้ขายไว้ในแถวของตัวเอง (บทที่ 11-12)
 *    ที่นี่จึงแก้ `Branch`/`Tenant` ได้อย่างอิสระ **มีเทสต์ตรึงไว้ว่าใบเก่าไม่เปลี่ยน**
 * 2. **เปลี่ยนสกุลเงินไม่ได้ถ้าสาขานี้เคยรับเงินแล้ว** — ยอดทุกคอลัมน์เก็บเป็น
 *    "จำนวนหน่วยย่อยของสกุลเงินสาขา" เลข 6000 ที่เคยแปลว่า ฿60.00 จะกลายเป็น
 *    ₭6,000 ทันทีที่สลับสกุล = ประวัติการเงินทั้งร้านถูกตีความใหม่โดยไม่มีใครสั่ง
 * 3. **อัตราทุกตัวเป็น basis point จำนวนเต็ม 0-10000** ห้ามรับ float (กฎเรื่องเงิน
 *    ของทั้งโปรเจกต์) และ 10000 = 100% คือเพดานที่มีความหมาย
 * 4. **ทุกการแก้เขียน AuditLog พร้อมค่าก่อน-หลัง** แม้ค่าจะไม่เปลี่ยน — สิ่งที่ต้อง
 *    ตอบให้ได้ย้อนหลังคือ "ตอนนั้นอัตราเท่าไหร่" ไม่ใช่แค่ "ครั้งไหนที่เปลี่ยน"
 *    (กติกาเดียวกับราคาเมนูในโมดูล 04)
 */

export type SettingsResult = { ok: false; error: string } | { ok: true; changed: boolean };

function fail(error: string) {
  return { ok: false as const, error };
}

/** 0-10000 basis point = 0-100% · ต้องเป็นจำนวนเต็มเสมอ */
function invalidRate(value: number, label: string): string | null {
  if (!Number.isInteger(value)) {
    return `${label} must be a whole number (in basis points)`;
  }

  if (value < 0 || value > 10000) {
    return `${label} must be between 0 and 10000 (0-100%)`;
  }

  return null;
}

/** ตรวจว่า timezone ที่ส่งมา Node รู้จักจริง — ผิดแล้วทั้งระบบคิดวันผิด */
function invalidTimezone(timezone: string): string | null {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return null;
  } catch {
    return `Unknown timezone "${timezone}"`;
  }
}

export async function getSettings(branchId: string) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { tenant: true },
  });

  if (!branch) {
    return null;
  }

  const [stations, paymentCount] = await Promise.all([
    prisma.station.findMany({
      where: { branchId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, sortOrder: true, isActive: true },
    }),
    prisma.payment.count({ where: { branchId } }),
  ]);

  return {
    branch,
    tenant: branch.tenant,
    stations,
    /**
     * เคยรับเงินไปแล้วกี่บิล — หน้าจอใช้ตัดสินว่าจะเปิดช่อง "สกุลเงิน" ให้แก้ไหม
     * (ตัวที่กันจริงคือ `updateTaxSettings()` ที่ตรวจซ้ำอีกชั้น)
     */
    paymentCount,
  };
}

async function writeSettingsAudit(input: {
  branchId: string;
  actorId: string;
  action: string;
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      branchId: input.branchId,
      staffId: input.actorId,
      action: input.action,
      entityType: "settings",
      entityId: input.entityId,
      ipAddress: await clientIp(),
      metadata: { before: input.before, after: input.after } as never,
    },
  });
}

/** อัตราภาษี/ค่าบริการ/ส่วนลดพนักงาน/สกุลเงิน/timezone — เจ้าของร้านเท่านั้น */
export async function updateTaxSettings(
  actor: CurrentStaff,
  input: {
    vatRateBp: number;
    serviceChargeBp: number;
    staffMealDiscountBp: number;
    pricesIncludeVat: boolean;
    currency: Currency;
    timezone: string;
  },
): Promise<SettingsResult> {
  if (!canEditTaxSettings(actor.role)) {
    return fail("Only the owner can edit tax and service charge rates");
  }

  const rateError =
    invalidRate(input.vatRateBp, "VAT rate") ??
    invalidRate(input.serviceChargeBp, "Service charge") ??
    invalidRate(input.staffMealDiscountBp, "Staff meal discount");

  if (rateError) {
    return fail(rateError);
  }

  if (!(input.currency in CURRENCIES)) {
    return fail(`Unknown currency "${input.currency}"`);
  }

  const timezoneError = invalidTimezone(input.timezone);
  if (timezoneError) {
    return fail(timezoneError);
  }

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: actor.branchId } });

  /**
   * สลับสกุลเงินหลังจากที่เคยรับเงินแล้ว = ตีความประวัติการเงินทั้งร้านใหม่
   *
   * ยอดทุกคอลัมน์เก็บเป็นจำนวนหน่วยย่อยของสกุลเงินสาขา (CLAUDE.md บทที่ 10)
   * เลข 6000 ที่เคยแปลว่า ฿60.00 จะกลายเป็น ₭6,000 ทันที — ใบเสร็จเก่า snapshot
   * สกุลเงินไว้แล้วจึงรอด แต่รายงานที่รวมยอดข้ามช่วงเวลาจะบวกคนละหน่วยเข้าด้วยกัน
   */
  if (input.currency !== branch.currency) {
    const payments = await prisma.payment.count({ where: { branchId: actor.branchId } });

    if (payments > 0) {
      return fail(
        `This branch has already taken ${payments} payment(s), so the currency can't change — every stored amount is in units of the current currency`,
      );
    }
  }

  const before = {
    vatRateBp: branch.vatRateBp,
    serviceChargeBp: branch.serviceChargeBp,
    staffMealDiscountBp: branch.staffMealDiscountBp,
    pricesIncludeVat: branch.pricesIncludeVat,
    currency: branch.currency,
    timezone: branch.timezone,
  };

  await prisma.branch.update({ where: { id: branch.id }, data: { ...input } });

  await writeSettingsAudit({
    branchId: branch.id,
    actorId: actor.id,
    action: "settings.tax_update",
    entityId: branch.id,
    before,
    after: { ...input },
  });

  return {
    ok: true,
    changed: JSON.stringify(before) !== JSON.stringify(input),
  };
}

/** ข้อมูลร้านที่ขึ้นบนใบเสร็จ — ชื่อกิจการ · เลขผู้เสียภาษี · ที่อยู่ · เบอร์ · ท้ายใบ */
export async function updateBusinessInfo(
  actor: CurrentStaff,
  input: {
    tenantName: string;
    taxId: string;
    branchName: string;
    addressLine: string;
    phone: string;
    receiptFooter: string;
  },
): Promise<SettingsResult> {
  if (!canEditSettings(actor.role)) {
    return fail("Your role can't edit business info");
  }

  const tenantName = input.tenantName.trim();
  const branchName = input.branchName.trim();

  if (!tenantName || !branchName) {
    return fail("Enter both the business name and branch name");
  }

  const taxId = input.taxId.replace(/\s|-/g, "").trim();

  /**
   * เลขประจำตัวผู้เสียภาษีไทยมี 13 หลักเสมอ — ปล่อยว่างได้ (สาขานอกไทย/ยังไม่จด)
   * แต่ถ้ากรอกมาต้องครบ ไม่งั้นใบกำกับภาษีอย่างย่อที่พิมพ์ออกไปใช้ไม่ได้จริง
   * และจะไม่มีใครรู้จนกว่าสรรพากรจะทัก
   */
  if (taxId && !/^\d{13}$/.test(taxId)) {
    return fail("Tax ID must be 13 digits");
  }

  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: actor.branchId },
    include: { tenant: true },
  });

  const before = {
    tenantName: branch.tenant.name,
    taxId: branch.tenant.taxId,
    branchName: branch.name,
    addressLine: branch.addressLine,
    phone: branch.phone,
    receiptFooter: branch.receiptFooter,
  };

  const after = {
    tenantName,
    taxId: taxId || null,
    branchName,
    addressLine: input.addressLine.trim() || null,
    phone: input.phone.trim() || null,
    receiptFooter: input.receiptFooter.trim() || null,
  };

  /**
   * แก้สองตารางในคำสั่งเดียว — ชื่อกิจการกับเลขผู้เสียภาษีอยู่ที่ `Tenant`
   * ส่วนที่อยู่/เบอร์/ท้ายใบอยู่ที่ `Branch` ถ้าอันหนึ่งสำเร็จอีกอันล้ม
   * ใบเสร็จจะพิมพ์ข้อมูลผสมสองยุคออกมา
   */
  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: branch.tenantId },
      data: { name: after.tenantName, taxId: after.taxId },
    }),
    prisma.branch.update({
      where: { id: branch.id },
      data: {
        name: after.branchName,
        addressLine: after.addressLine,
        phone: after.phone,
        receiptFooter: after.receiptFooter,
      },
    }),
  ]);

  await writeSettingsAudit({
    branchId: branch.id,
    actorId: actor.id,
    action: "settings.business_update",
    entityId: branch.id,
    before,
    after,
  });

  return { ok: true, changed: JSON.stringify(before) !== JSON.stringify(after) };
}

/**
 * เพิ่ม/แก้สถานีครัว (spec §24)
 *
 * `stationId = null` = สร้างใหม่ · KDS กรองตั๋วด้วย `OrderItem.stationId` ที่
 * snapshot ไว้ตอนสั่ง การเปลี่ยนชื่อสถานีจึงไม่กระทบตั๋วที่อยู่บนจอครัวอยู่แล้ว
 */
export async function upsertStation(
  actor: CurrentStaff,
  stationId: string | null,
  input: { code: string; name: string; sortOrder: number; isActive: boolean },
): Promise<SettingsResult & { stationId?: string }> {
  if (!canEditSettings(actor.role)) {
    return fail("Your role can't edit kitchen stations");
  }

  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();

  if (!code || !name) {
    return fail("Enter a station code and name");
  }

  if (!Number.isInteger(input.sortOrder)) {
    return fail("Sort order must be a whole number");
  }

  const existing = stationId
    ? await prisma.station.findFirst({ where: { id: stationId, branchId: actor.branchId } })
    : null;

  if (stationId && !existing) {
    return fail("Station not found in your branch");
  }

  const duplicate = await prisma.station.findFirst({
    where: { branchId: actor.branchId, code, ...(existing ? { id: { not: existing.id } } : {}) },
    select: { id: true },
  });

  if (duplicate) {
    return fail(`Station code ${code} already exists in this branch`);
  }

  const saved = existing
    ? await prisma.station.update({
        where: { id: existing.id },
        data: { code, name, sortOrder: input.sortOrder, isActive: input.isActive },
        select: { id: true },
      })
    : await prisma.station.create({
        data: {
          branchId: actor.branchId,
          code,
          name,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        },
        select: { id: true },
      });

  await writeSettingsAudit({
    branchId: actor.branchId,
    actorId: actor.id,
    action: "settings.station_upsert",
    entityId: saved.id,
    before: existing
      ? {
          code: existing.code,
          name: existing.name,
          sortOrder: existing.sortOrder,
          isActive: existing.isActive,
        }
      : {},
    after: { code, name, sortOrder: input.sortOrder, isActive: input.isActive },
  });

  return { ok: true, changed: true, stationId: saved.id };
}

/**
 * ลบสถานี — **ได้เฉพาะสถานีที่ไม่เคยถูกใช้เลย** (กติกาเดียวกับเมนูในโมดูล 04)
 *
 * สถานีที่เคยมีตั๋วผ่านต้องอ้างถึงได้ตลอดไป เพราะ `OrderItem.stationId` ชี้มาที่มัน
 * และรายงาน "ครัวไหนช้า" ในบทที่ 15 อ่านจากตรงนั้น — ที่เหลือใช้ปิดใช้งานแทน
 */
export async function deleteStation(
  actor: CurrentStaff,
  stationId: string,
): Promise<SettingsResult> {
  if (!canEditSettings(actor.role)) {
    return fail("Your role can't edit kitchen stations");
  }

  const station = await prisma.station.findFirst({
    where: { id: stationId, branchId: actor.branchId },
  });

  if (!station) {
    return fail("Station not found in your branch");
  }

  const [orderItems, menuItems] = await Promise.all([
    prisma.orderItem.count({ where: { stationId: station.id } }),
    prisma.menuItem.count({ where: { stationId: station.id } }),
  ]);

  if (orderItems > 0) {
    return fail(
      `This station has handled ${orderItems} order item(s) — can't delete. Disable it instead`,
    );
  }

  if (menuItems > 0) {
    return fail(`${menuItems} item(s) are still linked to this station — move them first`);
  }

  await prisma.station.delete({ where: { id: station.id } });

  await writeSettingsAudit({
    branchId: actor.branchId,
    actorId: actor.id,
    action: "settings.station_delete",
    entityId: station.id,
    before: { code: station.code, name: station.name },
    after: {},
  });

  return { ok: true, changed: true };
}
