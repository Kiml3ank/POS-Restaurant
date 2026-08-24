import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { canReadAuditLog } from "@/lib/rbac";
import { prisma } from "@/lib/server/db";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * อ่าน AuditLog (บทที่ 13)
 *
 * ตารางนี้ **เขียนอย่างเดียว** ทั้งระบบ ไฟล์นี้จึงมีแต่ฟังก์ชันอ่าน
 * ห้ามเพิ่ม update/delete ที่นี่หรือที่ไหนก็ตาม — log ที่แก้ได้ไม่ใช่ log
 *
 * `canReadAuditLog` = OWNER/MANAGER เท่านั้น เพราะ log เผยทุกการกระทำของทุกคน
 * รวมยอดเงินทุกบิลและชื่อคนที่ใส่ PIN ผิด (ดูเหตุผลใน lib/rbac.ts)
 */

export const AUDIT_PAGE_SIZE = 40;

export type AuditLogFilters = {
  /** ช่วงวันตามเวลาของสาขา รูปแบบ YYYY-MM-DD */
  from?: string | null;
  to?: string | null;
  action?: string | null;
  staffId?: string | null;
  /** ค้นด้วย entityId ตรง ๆ — ใช้ตอนไล่จากบิล/ใบเสร็จใบหนึ่งว่ามีอะไรเกิดขึ้นบ้าง */
  entityId?: string | null;
  page?: number;
};

export type AuditLogRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Prisma.JsonValue;
  ipAddress: string | null;
  createdAt: Date;
  staffName: string | null;
  staffRole: string | null;
};

export type ListAuditLogsResult =
  | { ok: false; error: string }
  | {
      ok: true;
      rows: AuditLogRow[];
      page: number;
      pageCount: number;
      total: number;
      /** action ทั้งหมดที่สาขานี้เคยมี — ใช้เติมตัวเลือกในกล่องกรอง */
      actions: string[];
      staff: Array<{ id: string; name: string }>;
    };

export async function listAuditLogs(
  staff: CurrentStaff,
  filters: AuditLogFilters = {},
): Promise<ListAuditLogsResult> {
  if (!canReadAuditLog(staff.role)) {
    return { ok: false, error: "ตำแหน่งของคุณไม่มีสิทธิ์อ่านบันทึกการใช้งาน" };
  }

  const where: Prisma.AuditLogWhereInput = { branchId: staff.branchId };

  const range = dayRangeToUtc(filters.from, filters.to, staff.branch.timezone);
  if (range) where.createdAt = range;
  if (filters.action) where.action = filters.action;
  if (filters.staffId) where.staffId = filters.staffId;

  const entityId = filters.entityId?.trim();
  if (entityId) where.entityId = entityId;

  const page = Math.max(1, Math.trunc(filters.page ?? 1));

  const [total, logs, actionGroups, staffList] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      include: { staff: { select: { name: true, role: true } } },
    }),
    /**
     * รายการ action ที่ **มีอยู่จริงในฐาน** ไม่ใช่รายการที่ hardcode ไว้ —
     * บทถัดไปที่เพิ่ม action ใหม่จะโผล่ในกล่องกรองเองโดยไม่ต้องมาแก้ไฟล์นี้
     */
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { branchId: staff.branchId },
      orderBy: { action: "asc" },
    }),
    prisma.staff.findMany({
      where: { branchId: staff.branchId },
      orderBy: { code: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return {
    ok: true,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    actions: actionGroups.map((group) => group.action),
    staff: staffList,
    rows: logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      metadata: log.metadata,
      ipAddress: log.ipAddress,
      createdAt: log.createdAt,
      staffName: log.staff?.name ?? null,
      staffRole: log.staff?.role ?? null,
    })),
  };
}

/**
 * แปลงช่วงวัน YYYY-MM-DD ตามเวลาของสาขาให้เป็นช่วง UTC
 *
 * สำเนาตรรกะเดียวกับใน lib/server/receipt.ts โดยตั้งใจ **ยังไม่ยุบรวม** —
 * ถ้ายุบตอนนี้จะได้ helper ที่มีผู้ใช้สองรายซึ่งยังไม่พอจะรู้ว่ารูปร่างที่ถูก
 * คืออะไร (บทที่ 15 จะมีตัวที่สามที่ต้องรับ "ช่วงกะ" ซึ่งไม่ใช่ขอบเขตวัน)
 * ตอนนั้นค่อยยุบทีเดียวโดยรู้ความต้องการจริงทั้งสามแบบ
 */
function dayRangeToUtc(
  from: string | null | undefined,
  to: string | null | undefined,
  timezone: string,
): { gte?: Date; lt?: Date } | null {
  const gte = from ? startOfDayUtc(from, timezone) : undefined;
  const lt = to ? startOfDayUtc(to, timezone, 1) : undefined;
  if (!gte && !lt) return null;
  return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
}

function startOfDayUtc(ymd: string, timezone: string, addDays = 0): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return undefined;

  const [, y, m, d] = match;
  const base = Date.UTC(Number(y), Number(m) - 1, Number(d) + addDays);
  return new Date(base - timezoneOffsetMs(new Date(base), timezone));
}

function timezoneOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");

  return (
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) -
    at.getTime()
  );
}
