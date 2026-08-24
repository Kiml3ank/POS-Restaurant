import "server-only";

import type { StaffScreenKind } from "@/lib/generated/prisma/enums";
import type { StaffScreen } from "@/lib/rbac";
import { STAFF_SCREEN_KIND } from "@/lib/staff-session-cookie";
import { prisma } from "@/lib/server/db";

/**
 * ที่เก็บ session ของพนักงานใน DB (บทที่ 13b)
 *
 * ── ปัญหาที่ไฟล์นี้แก้ ────────────────────────────────────────────────────
 * ตั้งแต่บทที่ 9 session เป็น cookie ที่เซ็น HMAC ล้วน ๆ ซึ่งพิสูจน์ได้ว่า
 * "เราออกใบนี้เอง" แต่ตอบไม่ได้ว่า "ตอนนี้ยังใช้ได้อยู่ไหม" ผลคือ **ยกเลิก session
 * ทันทีไม่ได้** ต้องรอหมดอายุ 8 ชั่วโมง — พนักงานที่เพิ่งถูกให้ออกตอนบ่ายยังเปิด
 * เครื่อง POS ได้จนถึงเย็น ซึ่งเป็นข้อจำกัดที่จดค้างไว้ใน CLAUDE.md ตั้งแต่บทที่ 9
 *
 * ตอนนี้ cookie เก็บแค่ **id ของแถวใน `StaffSession`** คำตอบว่าใช้ได้ไหมมาจาก DB
 * ทุก request — ลายเซ็นยังอยู่ (กันคนเดา id ของคนอื่น) แต่ไม่ใช่คำตอบสุดท้ายอีกต่อไป
 *
 * ── ทำไมแยกไฟล์จาก staff-session.ts ─────────────────────────────────────
 * ไฟล์นั้นเรียก `cookies()` ของ next/headers จึงรันนอก request ของ Next ไม่ได้
 * ตรรกะทั้งหมดที่นี่จึงทดสอบไม่ได้เลยถ้าอยู่ในไฟล์เดียวกัน
 * (ท่าเดียวกับ lib/server/receipt-issue.ts ในบทที่ 12)
 */

/** อายุ session — สั้นพอที่เครื่องที่ลืมล็อกจะหมดอายุเองภายในกะเดียว */
export const SESSION_TTL_HOURS = 8;

/** เหตุผลที่ session ถูกปิด — เก็บเป็นค่าคงที่เพื่อให้หน้าจอแปลเป็นภาษาไทยได้ */
export const SESSION_REVOKE_REASONS = {
  /** เจ้าตัวกดล็อกจอเอง */
  logout: "logout",
  /** ผู้จัดการกด "เตะออกทุกเครื่อง" */
  revokedAll: "revoked_all",
  /** ถูกรีเซ็ต PIN — ใบเก่าต้องใช้ไม่ได้ทันที ไม่งั้นการรีเซ็ต PIN แทบไม่มีความหมาย */
  pinReset: "pin_reset",
  /** บัญชีถูกปิดใช้งาน */
  deactivated: "deactivated",
} as const;

export type SessionRevokeReason =
  (typeof SESSION_REVOKE_REASONS)[keyof typeof SESSION_REVOKE_REASONS];

export async function createStaffSession(input: {
  staffId: string;
  branchId: string;
  screen: StaffScreen;
  ipAddress?: string | null;
}) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  return prisma.staffSession.create({
    data: {
      staffId: input.staffId,
      branchId: input.branchId,
      screen: STAFF_SCREEN_KIND[input.screen],
      ipAddress: input.ipAddress ?? null,
      expiresAt,
    },
  });
}

/**
 * อ่าน session ที่ **ยังใช้ได้จริง** พร้อมข้อมูลพนักงาน — query ครั้งเดียวจบ
 *
 * เงื่อนไขครบชุดอยู่ที่นี่ที่เดียว: ยังไม่ถูกยกเลิก · ยังไม่หมดอายุ · เป็นของจอนี้ ·
 * บัญชียัง `isActive` — **ห้ามกระจายเงื่อนไขพวกนี้ไปเขียนซ้ำที่ไหนอีก** เพราะที่ที่
 * ลืมไปข้อหนึ่งจะกลายเป็นประตูหลังที่เปิดค้างอยู่โดยไม่มีใครเห็น
 *
 * `screen` ต้องตรงเสมอ (ใบของ POS เปิด /kds ไม่ได้) ยกเว้นผู้เรียกที่ตั้งใจไม่ระบุจอ
 * ซึ่งมีที่เดียวคือ /api/realtime — ท่อที่ให้สิทธิ์แค่ "ฟัง event ของสาขาตัวเอง"
 */
export async function loadActiveStaffSession(sessionId: string, screen?: StaffScreen) {
  const session = await prisma.staffSession.findFirst({
    where: {
      id: sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      ...(screen ? { screen: STAFF_SCREEN_KIND[screen] } : {}),
      staff: { isActive: true },
    },
    include: { staff: { include: { branch: true } } },
  });

  return session;
}

/** ปิด session ใบเดียว — ใช้ตอนกดล็อกจอ */
export async function revokeStaffSession(
  sessionId: string,
  options: { reason: SessionRevokeReason; byStaffId?: string | null },
) {
  const result = await prisma.staffSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: {
      revokedAt: new Date(),
      revokedReason: options.reason,
      revokedByStaffId: options.byStaffId ?? null,
    },
  });

  return result.count;
}

/**
 * ปิด session ทั้งหมดของพนักงานคนหนึ่ง = ปุ่ม "เตะออกทุกเครื่อง"
 *
 * คืนจำนวนใบที่เพิ่งถูกปิด เพื่อให้หน้าจอบอกได้ว่า "เตะออก 3 เครื่อง" ไม่ใช่แค่ "สำเร็จ"
 * — ตัวเลขนี้คือสิ่งที่ทำให้ผู้จัดการรู้ว่ามีเครื่องที่ไม่รู้จักค้างอยู่หรือเปล่า
 */
export async function revokeAllStaffSessions(
  staffId: string,
  options: {
    reason: SessionRevokeReason;
    byStaffId?: string | null;
    exceptSessionId?: string | null;
  },
) {
  const result = await prisma.staffSession.updateMany({
    where: {
      staffId,
      revokedAt: null,
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: {
      revokedAt: new Date(),
      revokedReason: options.reason,
      revokedByStaffId: options.byStaffId ?? null,
    },
  });

  return result.count;
}

/** เครื่องที่ยังล็อกอินค้างอยู่ของสาขา — ข้อมูลของหน้า "จัดการพนักงาน" */
export async function listActiveStaffSessions(branchId: string) {
  return prisma.staffSession.findMany({
    where: { branchId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      screen: true,
      createdAt: true,
      expiresAt: true,
      ipAddress: true,
      staff: { select: { id: true, name: true, code: true, role: true } },
    },
  });
}

/**
 * ประวัติการล็อกอินของพนักงานคนหนึ่ง (spec §26 Login history)
 *
 * อ่านจากตารางเดียวกับ session ที่ยังใช้อยู่ เพราะแถวไม่ถูกลบตอนล็อกจอ —
 * ตั้ง `revokedAt` แทน ประวัติจึงเป็นผลพลอยได้ ไม่ใช่ตารางที่สองที่ต้องเขียนซ้ำ
 */
export async function listStaffLoginHistory(branchId: string, staffId: string, take = 20) {
  return prisma.staffSession.findMany({
    where: { branchId, staffId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      screen: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      revokedReason: true,
      ipAddress: true,
      revokedBy: { select: { name: true } },
    },
  });
}

/**
 * ลบ session เก่าที่หมดอายุไปนานแล้ว — เรียกแบบ fire-and-forget ตอนล็อกอิน
 *
 * เก็บไว้ 30 วันเพราะเป็นข้อมูลที่ใช้ตอบคำถามย้อนหลัง ("วันนั้นใครเปิดเครื่องบ้าง")
 * แต่เก็บตลอดกาลไม่ได้ ตารางนี้โตทุกครั้งที่มีคนใส่ PIN
 */
export async function purgeExpiredStaffSessions(olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await prisma.staffSession.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  return result.count;
}

export type StaffScreenKindValue = StaffScreenKind;
