import "server-only";

import { randomBytes } from "node:crypto";

import type { Currency, SalePointKind } from "@/lib/generated/prisma/enums";
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

  const [stations, tables, paymentCount] = await Promise.all([
    prisma.station.findMany({
      where: { branchId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, sortOrder: true, isActive: true },
    }),
    /**
     * จุดขายทั้งหมดของสาขา (โต๊ะนั่ง + เคาน์เตอร์ + ช่องไรเดอร์)
     *
     * `_count` มาด้วยเพราะหน้าจอต้องรู้ก่อนกดว่า "ลบได้ไหม" — กติกาเดียวกับ
     * สถานีครัวและเมนู: ลบจริงได้เฉพาะของที่ไม่เคยถูกใช้ ที่เหลือปิดใช้งานแทน
     * และต้องนับ `sessions` ด้วย ไม่ใช่แค่ `orders` เพราะ
     * `TableSession.tableId` เป็น **Cascade** — ลบโต๊ะแล้วรอบขายเก่าจะหายตามไป
     * เงียบ ๆ ทั้งที่มันคือประวัติ (ต่างจาก `Order.tableId` ที่เป็น Restrict
     * และฐานข้อมูลจะกันให้เอง)
     */
    prisma.restaurantTable.findMany({
      where: { branchId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        tableCode: true,
        seats: true,
        kind: true,
        sortOrder: true,
        isActive: true,
        _count: { select: { orders: true, sessions: true } },
        sessions: {
          where: { status: "OPEN" },
          select: { id: true },
          take: 1,
        },
      },
    }),
    prisma.payment.count({ where: { branchId } }),
  ]);

  return {
    branch,
    tenant: branch.tenant,
    stations,
    tables: tables.map((table) => {
      const { sessions, ...rest } = table;
      return {
        ...rest,
        /** มีบิลเปิดค้างอยู่ไหม — ห้ามปิดใช้งาน/ลบขณะที่ยังมีเงินค้าง */
        hasOpenSession: sessions.length > 0,
        /** ไม่เคยถูกใช้เลย = ลบจริงได้ · เคยถูกใช้ = ปิดใช้งานได้อย่างเดียว */
        deletable: table._count.orders === 0 && table._count.sessions === 0,
      };
    }),
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

/**
 * ── จุดขาย (โต๊ะ / เคาน์เตอร์ / ช่องไรเดอร์) ────────────────────────────────
 *
 * ก่อนหน้านี้เพิ่มโต๊ะได้จาก `prisma/seed.ts` ที่เดียว ซึ่งแปลว่าเจ้าของร้าน
 * ที่ซื้อโต๊ะเพิ่มต้องรอคนเขียนโค้ด — ปัญหาเดียวกับที่ทำให้ต้องมีหน้าตั้งค่า
 *
 * ⚠ สามฟังก์ชันข้างล่างไม่ใช่ CRUD ธรรมดา มีกฎที่ผูกกับ "เงิน" และ "QR" อยู่ด้วย
 * อ่านคอมเมนต์ของแต่ละตัวก่อนแก้
 */

/**
 * ตัวอักษรของ `tableCode` — ตัดตัวที่อ่านผิดกันได้ออก (0/O, 1/l/I)
 * เพราะรหัสนี้ถูก **พิมพ์ลงกระดาษ** แล้วมีคนพิมพ์ตามด้วยมือเวลากล้องสแกนไม่ติด
 */
const TABLE_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const TABLE_CODE_LENGTH = 6;

/**
 * สุ่ม `tableCode` ที่ยังไม่ซ้ำ — unique **ทั้งระบบ** ไม่ใช่แค่ในสาขา
 * (resolve จาก URL `/t/[tableCode]` ตรง ๆ โดยยังไม่รู้ว่าเป็นสาขาไหน)
 *
 * ใช้ `randomBytes` ไม่ใช่ `Math.random()` เพราะรหัสนี้คือสิ่งเดียวที่กันคนนอก
 * เปิดบิลของโต๊ะที่ตัวเองไม่ได้นั่ง — เดาได้ = เปิดบิลโต๊ะอื่นได้
 */
async function generateTableCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const bytes = randomBytes(TABLE_CODE_LENGTH);
    let code = "";

    for (let i = 0; i < TABLE_CODE_LENGTH; i += 1) {
      code += TABLE_CODE_ALPHABET[bytes[i] % TABLE_CODE_ALPHABET.length];
    }

    const taken = await prisma.restaurantTable.findUnique({
      where: { tableCode: code },
      select: { id: true },
    });

    if (!taken) {
      return code;
    }
  }

  // 31^6 ~ 887 ล้านค่า — ชนสิบครั้งติดแปลว่ามีอย่างอื่นผิด ไม่ใช่ดวงไม่ดี
  throw new Error("Could not generate a unique table code after 10 attempts");
}

export async function upsertTable(
  actor: CurrentStaff,
  tableId: string | null,
  input: { name: string; seats: number; sortOrder: number; kind: SalePointKind; isActive: boolean },
): Promise<SettingsResult & { tableId?: string; tableCode?: string }> {
  if (!canEditSettings(actor.role)) {
    return fail("Your role can't edit tables");
  }

  const name = input.name.trim();

  if (!name) {
    return fail("Enter a table name");
  }

  if (!Number.isInteger(input.seats) || input.seats < 0) {
    return fail("Seats must be a whole number of 0 or more");
  }

  if (!Number.isInteger(input.sortOrder)) {
    return fail("Sort order must be a whole number");
  }

  const existing = tableId
    ? await prisma.restaurantTable.findFirst({
        where: { id: tableId, branchId: actor.branchId },
        include: {
          _count: { select: { sessions: true } },
          sessions: { where: { status: "OPEN" }, select: { id: true }, take: 1 },
        },
      })
    : null;

  if (tableId && !existing) {
    return fail("Table not found in your branch");
  }

  // ชื่อซ้ำในสาขาเดียวกันไม่ได้ (@@unique([branchId, name])) — ตรวจเองก่อนเพื่อคืน
  // ข้อความที่คนอ่านรู้เรื่อง แทน P2002 ดิบ ๆ จาก Prisma
  const duplicate = await prisma.restaurantTable.findFirst({
    where: { branchId: actor.branchId, name, ...(existing ? { id: { not: existing.id } } : {}) },
    select: { id: true },
  });

  if (duplicate) {
    return fail(`A sale point named "${name}" already exists in this branch`);
  }

  /**
   * ⚠ ห้ามเปลี่ยน `kind` ของจุดขายที่เคยถูกใช้แล้ว
   *
   * `kind` ไม่ใช่ป้ายชื่อ แต่เป็นตัวตัดสิน **สี่ข้อพร้อมกัน** (ดู lib/sale-point.ts):
   * ขึ้นผังโต๊ะไหม · เข้าร่วมบิลเดิมไหม · ต้องมีเลขคิวไหม · **คิดเซอร์วิสชาร์จไหม**
   *
   * สลับ DINE_IN -> COUNTER บนโต๊ะที่มีประวัติ = ความหมายของบิลเก่าเปลี่ยนทันที
   * (เคยคิดค่าบริการ 10% กลายเป็นช่องที่ไม่คิด) และรอบที่เปิดค้างอยู่จะหลุด
   * จากผังโต๊ะไปโผล่ในแถบคิวโดยไม่มีเลขคิว
   */
  if (existing && existing.kind !== input.kind && existing._count.sessions > 0) {
    return fail(
      "This sale point already has sales history — its type can't be changed. Create a new one instead",
    );
  }

  /**
   * ⚠ ปิดใช้งานจุดขายที่มีบิลเปิดค้างไม่ได้
   *
   * `isActive: false` ทำให้มันหลุดจากทุก query ของหน้าร้าน (`isActive: true`
   * อยู่ในเงื่อนไขของ `getPosTables()`/`getPosTable()`) = บิลที่ยังไม่จ่ายหายไป
   * จากสายตาพนักงาน ซึ่งเป็นบั๊กตระกูลเดียวกับที่ `expiresAt` เคยทำไว้
   * (ดู archive/report/2026-08-25-expired-session-billable.md)
   */
  if (existing && existing.isActive && !input.isActive && existing.sessions.length > 0) {
    return fail("This sale point has an open bill — take payment or close it before disabling");
  }

  const saved = existing
    ? await prisma.restaurantTable.update({
        where: { id: existing.id },
        data: {
          name,
          seats: input.seats,
          sortOrder: input.sortOrder,
          kind: input.kind,
          isActive: input.isActive,
        },
        select: { id: true, tableCode: true },
      })
    : await prisma.restaurantTable.create({
        data: {
          branchId: actor.branchId,
          name,
          tableCode: await generateTableCode(),
          seats: input.seats,
          sortOrder: input.sortOrder,
          kind: input.kind,
          isActive: input.isActive,
        },
        select: { id: true, tableCode: true },
      });

  await writeSettingsAudit({
    branchId: actor.branchId,
    actorId: actor.id,
    action: "settings.table_upsert",
    entityId: saved.id,
    before: existing
      ? {
          name: existing.name,
          seats: existing.seats,
          sortOrder: existing.sortOrder,
          kind: existing.kind,
          isActive: existing.isActive,
        }
      : {},
    after: {
      name,
      seats: input.seats,
      sortOrder: input.sortOrder,
      kind: input.kind,
      isActive: input.isActive,
    },
  });

  return { ok: true, changed: true, tableId: saved.id, tableCode: saved.tableCode };
}

/**
 * ออก `tableCode` ใหม่ = **พิมพ์ QR ใหม่แล้วใบเก่าตายทันที**
 *
 * แยกเป็นปุ่มของตัวเอง ไม่ใช่ช่องกรอกในฟอร์ม ด้วยเหตุผลเดียวกับปุ่มรีเซ็ต PIN
 * ในบทที่ 13b: มันคือ **การเพิกถอนของเก่า** ไม่ใช่การแก้ข้อมูล คนกดต้องตั้งใจกด
 *
 * ใช้ตอน QR รั่ว (ลูกค้าถ่ายรูปไว้แล้วสั่งจากบ้าน / กระดาษหลุดไปนอกร้าน)
 * — อีกชั้นที่กันเรื่องเดียวกันคือ `TableSession.expiresAt` แต่ตัวนั้นกันได้แค่
 * รอบที่เปิดอยู่ ส่วนตัวนี้ตัดที่ตัว QR เลย
 */
export async function rotateTableCode(
  actor: CurrentStaff,
  tableId: string,
): Promise<SettingsResult & { tableCode?: string }> {
  if (!canEditSettings(actor.role)) {
    return fail("Your role can't reissue QR codes");
  }

  const table = await prisma.restaurantTable.findFirst({
    where: { id: tableId, branchId: actor.branchId },
  });

  if (!table) {
    return fail("Table not found in your branch");
  }

  const tableCode = await generateTableCode();

  await prisma.restaurantTable.update({
    where: { id: table.id },
    data: { tableCode },
  });

  await writeSettingsAudit({
    branchId: actor.branchId,
    actorId: actor.id,
    action: "settings.table_rotate_qr",
    entityId: table.id,
    // เก็บรหัสเก่าไว้ด้วย เพื่อตอบได้ว่า QR ใบที่ลูกค้าถือมาเป็นของรอบไหน
    before: { name: table.name, tableCode: table.tableCode },
    after: { name: table.name, tableCode },
  });

  return { ok: true, changed: true, tableCode };
}

/**
 * ลบจุดขาย — **ได้เฉพาะตัวที่ไม่เคยถูกใช้เลย** (กติกาเดียวกับสถานีครัวและเมนู)
 *
 * ⚠ ต้องนับ `sessions` เองด้วย ห้ามพึ่งฐานข้อมูลอย่างเดียว:
 * `Order.tableId` เป็น Restrict (ฐานกันให้) แต่ `TableSession.tableId` เป็น
 * **Cascade** — โต๊ะที่เคยเปิดรอบแต่ลูกค้ายังไม่ได้สั่งอะไร จะลบผ่านฉลุยแล้ว
 * พารอบขายเก่าหายไปด้วยเงียบ ๆ ทั้งที่มันคือประวัติที่ AuditLog อ้างถึงอยู่
 */
export async function deleteTable(actor: CurrentStaff, tableId: string): Promise<SettingsResult> {
  if (!canEditSettings(actor.role)) {
    return fail("Your role can't delete tables");
  }

  const table = await prisma.restaurantTable.findFirst({
    where: { id: tableId, branchId: actor.branchId },
  });

  if (!table) {
    return fail("Table not found in your branch");
  }

  const [orders, sessions] = await Promise.all([
    prisma.order.count({ where: { tableId: table.id } }),
    prisma.tableSession.count({ where: { tableId: table.id } }),
  ]);

  if (orders > 0 || sessions > 0) {
    return fail(`"${table.name}" already has sales history — can't delete. Disable it instead`);
  }

  await prisma.restaurantTable.delete({ where: { id: table.id } });

  await writeSettingsAudit({
    branchId: actor.branchId,
    actorId: actor.id,
    action: "settings.table_delete",
    entityId: table.id,
    before: { name: table.name, tableCode: table.tableCode, kind: table.kind },
    after: {},
  });

  return { ok: true, changed: true };
}
