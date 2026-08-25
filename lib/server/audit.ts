import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { canReadAuditLog } from "@/lib/rbac";
import { branchDayRangeUtc } from "@/lib/server/branch-time";
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
    return { ok: false, error: "Your role can't read the audit log" };
  }

  const where: Prisma.AuditLogWhereInput = { branchId: staff.branchId };

  const range = branchDayRangeUtc(filters.from, filters.to, staff.branch.timezone);
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
