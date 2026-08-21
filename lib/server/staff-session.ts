import "server-only";

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

import { STAFF_SESSION_COOKIE } from "@/lib/staff-session-cookie";
import { prisma } from "@/lib/server/db";
import { verifyPin } from "@/lib/server/pin";

/**
 * Session ของพนักงานหน้าร้าน (บทที่ 9 + 13)
 *
 * เก็บเป็น cookie ที่เซ็นด้วย HMAC ไม่ใช่ตารางใน DB — เลือกแบบนี้เพราะ
 * ทุกหน้าของ POS ต้องเช็คสิทธิ์ ถ้าต้อง query DB ทุก request จะเปลืองโดยไม่จำเป็น
 *
 * ราคาที่จ่ายคือ "ยกเลิก session ทันทีไม่ได้" (ต้องรอหมดอายุ) —
 * บทที่ 13 ที่ต้องมีปุ่ม "เตะพนักงานคนนี้ออกทุกเครื่อง" ค่อยเพิ่มตาราง StaffSession
 * แล้วเช็ค revoke list ทับอีกชั้น
 *
 * รูปแบบค่าใน cookie: base64url(payload).base64url(hmac)
 */
export { STAFF_SESSION_COOKIE };

/** อายุ session — สั้นพอที่เครื่องที่ลืมล็อกจะหมดอายุเองภายในกะเดียว */
const SESSION_TTL_HOURS = 8;

/** กรอก PIN ผิดเกินจำนวนนี้ในหนึ่งช่วงเวลา = ล็อกรหัสพนักงานคนนั้นไว้ชั่วคราว */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 5;

type StaffTokenPayload = {
  /** staffId */
  sid: string;
  /** branchId — ติดมาด้วยเพื่อไม่ต้อง query ซ้ำตอนกรองข้อมูลตามสาขา */
  bid: string;
  /** วันหมดอายุ (epoch milliseconds) */
  exp: number;
};

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "ไม่พบ AUTH_SECRET (หรือสั้นเกินไป) — ดูวิธีสร้างค่าใหม่ที่ .env.example",
    );
  }

  return secret;
}

const sign = (data: string) => createHmac("sha256", authSecret()).update(data).digest("base64url");

function createToken(payload: StaffTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function readToken(token: string): StaffTokenPayload | null {
  const [body, signature] = token.split(".");

  if (!body || !signature) {
    return null;
  }

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);

  // เทียบลายเซ็นแบบ timing-safe เหมือนตอนเทียบ PIN
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as StaffTokenPayload;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

/**
 * ตัวนับ PIN ผิดแบบเก็บใน memory ของ process
 *
 * ข้อจำกัดที่ต้องรู้: ถ้า deploy หลาย instance ตัวนับจะไม่แชร์กัน คนร้ายที่สลับ
 * instance ไปเรื่อย ๆ จะได้โควตาใหม่ทุกครั้ง — บทที่ 13 ต้องย้ายไปเก็บที่ Redis
 * หรือตารางใน Postgres ตอนนี้ที่มีดีกว่าไม่มี และคู่กับ AuditLog ที่บันทึกทุกครั้งที่ผิด
 */
const failedAttempts = new Map<string, { count: number; until: number }>();

function attemptKey(branchCode: string, staffCode: string) {
  return `${branchCode}:${staffCode}`;
}

/** ล็อกอินด้วยรหัสพนักงาน + PIN */
export async function loginStaff(staffCode: string, pin: string) {
  const code = staffCode.trim();

  if (!code || !pin) {
    return { ok: false as const, error: "กรุณากรอกรหัสพนักงานและ PIN" };
  }

  const staff = await prisma.staff.findFirst({
    where: { code, isActive: true },
    include: { branch: true },
  });

  // ข้อความเดียวกันทั้งกรณีไม่มีรหัสนี้และกรณี PIN ผิด เพื่อไม่ให้ใช้หน้าล็อกอิน
  // ไล่เดาว่ารหัสพนักงานไหนมีอยู่จริง
  const invalid = { ok: false as const, error: "รหัสพนักงานหรือ PIN ไม่ถูกต้อง" };

  if (!staff) {
    return invalid;
  }

  const key = attemptKey(staff.branchId, code);
  const locked = failedAttempts.get(key);

  if (locked && locked.count >= MAX_FAILED_ATTEMPTS && locked.until > Date.now()) {
    const minutes = Math.ceil((locked.until - Date.now()) / 60_000);
    return { ok: false as const, error: `กรอกผิดหลายครั้งเกินไป ลองใหม่ในอีก ${minutes} นาที` };
  }

  if (!verifyPin(pin, staff.pinHash)) {
    const next = { count: (locked?.count ?? 0) + 1, until: Date.now() + LOCKOUT_MINUTES * 60_000 };
    failedAttempts.set(key, next);

    // ตารางนี้เขียนอย่างเดียว ห้าม update/delete — เป็นหลักฐานเวลามีคนไล่สุ่ม PIN
    await prisma.auditLog.create({
      data: {
        branchId: staff.branchId,
        staffId: staff.id,
        action: "staff.login_failed",
        entityType: "staff",
        entityId: staff.id,
        metadata: { staffCode: code, attempt: next.count },
      },
    });

    return invalid;
  }

  failedAttempts.delete(key);

  await prisma.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });

  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const store = await cookies();

  store.set(STAFF_SESSION_COOKIE, createToken({ sid: staff.id, bid: staff.branchId, exp: expiresAt.getTime() }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return { ok: true as const, staff };
}

export async function logoutStaff() {
  const store = await cookies();
  store.delete(STAFF_SESSION_COOKIE);
}

/**
 * พนักงานที่ล็อกอินอยู่ตอนนี้ — null เมื่อไม่มี cookie / ลายเซ็นไม่ผ่าน / หมดอายุ
 *
 * ยัง query Staff ทุกครั้งแม้จะมี id อยู่ใน cookie แล้ว เพราะต้องรู้ว่า
 * บัญชีถูกปิด (isActive = false) หรือเปลี่ยนตำแหน่งไปแล้วหรือยัง —
 * cookie ที่เซ็นไว้เมื่อเช้าไม่ควรมีอำนาจของตำแหน่งที่ถูกถอดไปแล้วเมื่อบ่าย
 */
export async function getCurrentStaff() {
  const store = await cookies();
  const token = store.get(STAFF_SESSION_COOKIE)?.value;
  const payload = token ? readToken(token) : null;

  if (!payload) {
    return null;
  }

  const staff = await prisma.staff.findFirst({
    where: { id: payload.sid, isActive: true },
    include: { branch: true },
  });

  return staff && staff.branchId === payload.bid ? staff : null;
}

export type CurrentStaff = NonNullable<Awaited<ReturnType<typeof getCurrentStaff>>>;
