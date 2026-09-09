import "server-only";

import type { StaffRole } from "@/lib/generated/prisma/enums";
import { canAssignRole, canManageStaff, canManageStaffMember } from "@/lib/rbac";
import { clientIp } from "@/lib/server/client-ip";
import { prisma } from "@/lib/server/db";
import { hashPin } from "@/lib/server/pin";
import type { MessageParams } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";
import type { CurrentStaff } from "@/lib/server/staff-session";
import {
  SESSION_REVOKE_REASONS,
  listActiveStaffSessions,
  listStaffLoginHistory,
  revokeAllStaffSessions,
} from "@/lib/server/staff-session-store";

/**
 * จัดการบัญชีพนักงานจากหน้าหลังร้าน (บทที่ 13b · spec §12)
 *
 * ── ก่อนหน้านี้ทำได้จาก seed เท่านั้น ────────────────────────────────────
 * เพิ่มคนใหม่ = แก้ `prisma/seed.ts` แล้วรันใหม่ ซึ่งแปลว่าร้านจริงเพิ่มพนักงาน
 * ไม่ได้เลยถ้าไม่มีคนเขียนโค้ดอยู่ด้วย — และ "ลืม PIN" ซึ่งเกิดทุกสัปดาห์
 * กลายเป็นเรื่องที่ต้องรอ deploy
 *
 * ── กฎที่ไฟล์นี้บังคับ และเหตุผล ─────────────────────────────────────────
 * 1. **แก้ได้เฉพาะคนในสาขาตัวเอง** — เหมือนทุก query ในระบบนี้
 * 2. **แก้ได้เฉพาะตำแหน่งที่ต่ำกว่าตัวเอง** (`canAssignRole`) กันผู้จัดการ
 *    ตั้งบัญชี OWNER ให้ตัวเองในสองคลิก
 * 3. **ห้ามปิด/ลดตำแหน่งบัญชีตัวเอง** — คนที่เพิ่งลดตำแหน่งตัวเองจะแก้กลับไม่ได้
 *    และถ้าเป็น OWNER คนสุดท้ายก็จะไม่เหลือใครแก้ได้เลยทั้งร้าน
 * 4. **ต้องเหลือ OWNER ที่ใช้งานได้อย่างน้อยหนึ่งคนเสมอ**
 * 5. **รีเซ็ต PIN / ปิดบัญชี = เตะ session ทุกใบของคนนั้นทันที** ไม่งั้นการรีเซ็ต
 *    แทบไม่มีความหมาย เพราะเครื่องที่เปิดค้างอยู่ยังใช้ต่อได้จนหมดอายุ
 * 6. **ทุกการกระทำเขียน AuditLog** พร้อมค่าก่อน-หลัง (กติกาเดียวกับ menu-admin.ts)
 *
 * ไม่มีฟังก์ชัน "ลบพนักงาน" โดยตั้งใจ — พนักงานที่เคยเปิดโต๊ะ/รับเงิน/ถูกอ้างใน
 * AuditLog ต้องอ้างถึงได้ตลอดไป ปิดใช้งาน (`isActive = false`) คือคำตอบ
 * (หลักการเดียวกับเมนูที่เคยถูกสั่งแล้วห้ามลบ)
 */

/** PIN สั้นเกินไปเดาได้ ยาวเกินไปพนักงานจดใส่กระดาษแปะไว้ข้างเครื่อง */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

export type StaffAdminResult<T = undefined> =
  | { ok: false; errorKey: MessageKey; params?: MessageParams }
  | ({ ok: true } & (T extends undefined ? { staffId?: string } : T));

/**
 * คืน **คีย์** ไม่ใช่ประโยค — ชั้นธุรกิจไม่รู้จักภาษาที่ผู้ใช้เลือก
 * (กฎหัวข้อ 5 ของ spec i18n) หน้าจอเป็นคนแปลตอน render
 */
function fail(errorKey: MessageKey, params?: MessageParams) {
  return { ok: false as const, errorKey, params };
}

function normalizeCode(value: string) {
  return value.trim();
}

type PinProblem = { errorKey: MessageKey; params?: MessageParams };

function validatePin(pin: string): PinProblem | null {
  if (!/^\d+$/.test(pin)) {
    return { errorKey: "error.pin_digits_only" as const };
  }

  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    return {
      errorKey: "error.pin_length" as const,
      params: { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH },
    };
  }

  return null;
}

/** รายชื่อพนักงานของสาขา + จำนวนเครื่องที่ล็อกอินค้างอยู่ของแต่ละคน */
export async function listStaff(branchId: string) {
  const [staff, sessions] = await Promise.all([
    prisma.staff.findMany({
      where: { branchId },
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    listActiveStaffSessions(branchId),
  ]);

  const activeByStaff = new Map<string, number>();
  for (const session of sessions) {
    activeByStaff.set(session.staff.id, (activeByStaff.get(session.staff.id) ?? 0) + 1);
  }

  return staff.map((row) => ({ ...row, activeSessions: activeByStaff.get(row.id) ?? 0 }));
}

/** พนักงานหนึ่งคน + เครื่องที่ล็อกอินอยู่ + ประวัติการเข้า (spec §26) */
export async function getStaffMember(branchId: string, staffId: string) {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, branchId },
    select: {
      id: true,
      code: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  if (!staff) {
    return null;
  }

  const [sessions, history] = await Promise.all([
    listActiveStaffSessions(branchId).then((rows) => rows.filter((row) => row.staff.id === staffId)),
    listStaffLoginHistory(branchId, staffId),
  ]);

  /**
   * ตัดสินว่าแต่ละครั้งใน "ประวัติ" ยังใช้งานอยู่ไหมที่นี่ ไม่ใช่บนหน้าจอ
   *
   * `Date.now()` เป็นฟังก์ชันไม่บริสุทธิ์ เรียกระหว่าง render ของ React ไม่ได้
   * (eslint กฎ react-hooks/purity จับได้จริง) — และการอ่านนาฬิกาครั้งเดียว
   * ทำให้ทุกแถวบนจอตัดสินจากวินาทีเดียวกัน ไม่ใช่คนละวินาทีไล่ลงมา
   */
  const now = Date.now();

  return {
    staff,
    sessions,
    history: history.map((entry) => ({
      ...entry,
      stillValid: entry.revokedAt === null && entry.expiresAt.getTime() > now,
    })),
  };
}

async function writeStaffAudit(input: {
  branchId: string;
  actorId: string;
  action: string;
  targetId: string;
  metadata: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      branchId: input.branchId,
      staffId: input.actorId,
      action: input.action,
      entityType: "staff",
      entityId: input.targetId,
      ipAddress: await clientIp(),
      metadata: input.metadata as never,
    },
  });
}

export async function createStaffMember(
  actor: CurrentStaff,
  input: { code: string; name: string; role: StaffRole; pin: string },
) {
  if (!canManageStaff(actor.role)) {
    return fail("error.cannot_manage_staff");
  }

  if (!canAssignRole(actor.role, input.role)) {
    return fail("error.cannot_assign_role");
  }

  const code = normalizeCode(input.code);
  const name = input.name.trim();

  if (!code || !name) {
    return fail("error.staff_code_name_required");
  }

  const pinError = validatePin(input.pin);
  if (pinError) {
    return fail(pinError.errorKey, pinError.params);
  }

  const duplicate = await prisma.staff.findFirst({
    where: { branchId: actor.branchId, code },
    select: { id: true },
  });

  if (duplicate) {
    return fail("error.staff_code_duplicate", { code });
  }

  const created = await prisma.staff.create({
    data: {
      branchId: actor.branchId,
      code,
      name,
      role: input.role,
      pinHash: hashPin(input.pin),
    },
    select: { id: true },
  });

  await writeStaffAudit({
    branchId: actor.branchId,
    actorId: actor.id,
    action: "staff.create",
    targetId: created.id,
    metadata: { code, name, role: input.role },
  });

  return { ok: true as const, staffId: created.id };
}

export async function updateStaffMember(
  actor: CurrentStaff,
  staffId: string,
  input: { code: string; name: string; role: StaffRole; isActive: boolean },
) {
  if (!canManageStaff(actor.role)) {
    return fail("error.cannot_manage_staff");
  }

  const target = await prisma.staff.findFirst({
    where: { id: staffId, branchId: actor.branchId },
  });

  if (!target) {
    return fail("error.staff_not_found_branch");
  }

  if (!canManageStaffMember(actor.role, target.role)) {
    return fail("error.cannot_edit_this_role");
  }

  if (!canAssignRole(actor.role, input.role)) {
    return fail("error.cannot_assign_role");
  }

  /**
   * ห้ามแก้บัญชีตัวเองจากหน้านี้ — ไม่ใช่เพราะอันตรายทุกกรณี แต่เพราะกรณีที่
   * อันตรายจริง (ลดตำแหน่งตัวเอง / ปิดบัญชีตัวเอง) แก้กลับเองไม่ได้เลยหลังกด
   * ส่วนการเปลี่ยนชื่อตัวเองไม่ใช่เรื่องที่ต้องรีบพอจะยอมเปิดช่องนั้น
   */
  if (target.id === actor.id) {
    return fail("error.cannot_edit_own_account");
  }

  const code = normalizeCode(input.code);
  const name = input.name.trim();

  if (!code || !name) {
    return fail("error.staff_code_name_required");
  }

  const duplicate = await prisma.staff.findFirst({
    where: { branchId: actor.branchId, code, id: { not: target.id } },
    select: { id: true },
  });

  if (duplicate) {
    return fail("error.staff_code_duplicate", { code });
  }

  /**
   * ตาข่ายรองรับ: ห้ามเหลือสาขาที่ไม่มีเจ้าของร้านที่ใช้งานได้เลย
   *
   * ⚠ ตอนนี้เงื่อนไขนี้ **เรียกไม่ถึง** เพราะด่าน "ห้ามแก้บัญชีตัวเอง" ด้านบน
   * ปฏิเสธไปก่อนเสมอ (คนที่แก้ได้คือ OWNER อีกคน ซึ่งตัวเขาเองก็นับเป็น
   * เจ้าของร้านที่ใช้งานได้อยู่แล้ว) — เก็บไว้เพราะวันที่ใครผ่อนด่านแรก
   * (เช่น ยอมให้แก้ชื่อตัวเองได้) บรรทัดนี้คือสิ่งเดียวที่กันร้านไม่ให้
   * ล็อกตัวเองออกถาวร **ห้ามลบทิ้งเพราะ "ไม่มีเทสต์ครอบ"**
   */
  const losingLastOwner =
    target.role === "OWNER" && (input.role !== "OWNER" || !input.isActive);

  if (losingLastOwner) {
    const otherOwners = await prisma.staff.count({
      where: {
        branchId: actor.branchId,
        role: "OWNER",
        isActive: true,
        id: { not: target.id },
      },
    });

    if (otherOwners === 0) {
      return fail("error.owner_must_remain");
    }
  }

  await prisma.staff.update({
    where: { id: target.id },
    data: { code, name, role: input.role, isActive: input.isActive },
  });

  /**
   * ปิดบัญชี = เตะออกทุกเครื่องทันที
   *
   * `getCurrentStaff()` กรอง `isActive` อยู่แล้ว แต่ยังต้อง revoke เพราะแถว
   * session ที่ค้างอยู่คือสิ่งที่หน้าจอ "ใครล็อกอินอยู่บ้าง" แสดง — ปล่อยไว้
   * จะอ่านเหมือนคนที่ถูกปิดบัญชียังใช้เครื่องอยู่
   */
  let revokedSessions = 0;
  if (target.isActive && !input.isActive) {
    revokedSessions = await revokeAllStaffSessions(target.id, {
      reason: SESSION_REVOKE_REASONS.deactivated,
      byStaffId: actor.id,
    });
  }

  await writeStaffAudit({
    branchId: actor.branchId,
    actorId: actor.id,
    action: target.isActive && !input.isActive ? "staff.deactivate" : "staff.update",
    targetId: target.id,
    // เก็บค่าก่อน-หลังเสมอ แม้บางช่องไม่เปลี่ยน (กติกาเดียวกับราคาเมนู)
    metadata: {
      before: { code: target.code, name: target.name, role: target.role, isActive: target.isActive },
      after: { code, name, role: input.role, isActive: input.isActive },
      revokedSessions,
    },
  });

  return { ok: true as const, staffId: target.id, revokedSessions };
}

/**
 * รีเซ็ต PIN ให้พนักงานคนหนึ่ง — งานประจำวันจริง ("ลืม PIN ครับ")
 *
 * ผู้กดต้องพิมพ์ PIN ใหม่เอง ไม่ใช่ระบบสุ่มให้ เพราะจังหวะที่ใช้จริงคือพนักงาน
 * ยืนอยู่ตรงหน้าแล้วต้องกลับไปทำงานต่อทันที — PIN ที่ระบบสุ่มต้องอ่านให้ฟัง
 * แล้วเขาก็จะจดใส่กระดาษ ซึ่งแย่กว่าเลขที่เขาเลือกเอง
 */
export async function resetStaffPin(actor: CurrentStaff, staffId: string, pin: string) {
  if (!canManageStaff(actor.role)) {
    return fail("error.cannot_manage_staff");
  }

  const target = await prisma.staff.findFirst({
    where: { id: staffId, branchId: actor.branchId },
  });

  if (!target) {
    return fail("error.staff_not_found_branch");
  }

  if (!canManageStaffMember(actor.role, target.role)) {
    return fail("error.cannot_reset_this_pin");
  }

  const pinError = validatePin(pin);
  if (pinError) {
    return fail(pinError.errorKey, pinError.params);
  }

  await prisma.staff.update({ where: { id: target.id }, data: { pinHash: hashPin(pin) } });

  // PIN เก่าใช้ไม่ได้แล้ว แต่เครื่องที่ล็อกอินค้างอยู่ไม่ได้ใช้ PIN ต่อ — ต้องเตะออกเอง
  const revokedSessions = await revokeAllStaffSessions(target.id, {
    reason: SESSION_REVOKE_REASONS.pinReset,
    byStaffId: actor.id,
  });

  await writeStaffAudit({
    branchId: actor.branchId,
    actorId: actor.id,
    action: "staff.pin_reset",
    targetId: target.id,
    // ห้ามเก็บ PIN หรือ hash ลง log เด็ดขาด — log อ่านได้โดยคนที่ไม่ใช่เจ้าของบัญชี
    metadata: { code: target.code, name: target.name, revokedSessions },
  });

  return { ok: true as const, staffId: target.id, revokedSessions };
}

/** ปุ่ม "เตะออกทุกเครื่อง" — ใช้ตอนลืมล็อกจอทิ้งไว้ หรือสงสัยว่ามีคนอื่นใช้บัญชีอยู่ */
export async function revokeStaffSessions(actor: CurrentStaff, staffId: string) {
  if (!canManageStaff(actor.role)) {
    return fail("error.cannot_manage_staff");
  }

  const target = await prisma.staff.findFirst({
    where: { id: staffId, branchId: actor.branchId },
    select: { id: true, code: true, name: true, role: true },
  });

  if (!target) {
    return fail("error.staff_not_found_branch");
  }

  /**
   * เตะตัวเองออกได้ (ต่างจากการแก้ไขบัญชีตัวเอง) — เป็นสิ่งที่คนกดตั้งใจจริง ๆ
   * เมื่อรู้ตัวว่าลืมล็อกจอไว้ที่เครื่องอื่น และผลที่ตามมาแค่ต้องใส่ PIN ใหม่
   */
  if (target.id !== actor.id && !canManageStaffMember(actor.role, target.role)) {
    return fail("error.cannot_signout_this_role");
  }

  const revokedSessions = await revokeAllStaffSessions(target.id, {
    reason: SESSION_REVOKE_REASONS.revokedAll,
    byStaffId: actor.id,
  });

  await writeStaffAudit({
    branchId: actor.branchId,
    actorId: actor.id,
    action: "staff.session_revoke",
    targetId: target.id,
    metadata: { code: target.code, name: target.name, revokedSessions },
  });

  return { ok: true as const, staffId: target.id, revokedSessions };
}
