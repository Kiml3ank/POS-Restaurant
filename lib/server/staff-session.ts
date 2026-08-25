import "server-only";

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  LAST_STAFF_TTL_DAYS,
  decodeLastStaff,
  encodeLastStaff,
  lastStaffCookieName,
  type LastStaffOnDevice,
} from "@/lib/last-staff-cookie";
import type { StaffScreen } from "@/lib/rbac";
import { ALL_STAFF_SESSION_COOKIES, STAFF_SESSION_COOKIES } from "@/lib/staff-session-cookie";
import { clientIp } from "@/lib/server/client-ip";
import { prisma } from "@/lib/server/db";
import { verifyPin } from "@/lib/server/pin";
import {
  MAX_FAILED_ATTEMPTS,
  checkLoginThrottle,
  clearLoginThrottle,
  recordFailedLogin,
} from "@/lib/server/staff-login-throttle";
import {
  SESSION_REVOKE_REASONS,
  SESSION_TTL_HOURS,
  createStaffSession,
  loadActiveStaffSession,
  purgeExpiredStaffSessions,
  revokeStaffSession,
} from "@/lib/server/staff-session-store";

/**
 * Session ของพนักงานหน้าร้าน (บทที่ 9 · แก้ใหญ่ในบทที่ 13b)
 *
 * ── สิ่งที่เปลี่ยนในบทที่ 13b ─────────────────────────────────────────────
 * เดิม cookie ที่เซ็น HMAC **เป็นคำตอบสุดท้าย** ว่าใครล็อกอินอยู่ ซึ่งแปลว่า
 * ยกเลิก session ทันทีไม่ได้ ต้องรอหมดอายุ 8 ชั่วโมง
 *
 * ตอนนี้ cookie เก็บ `jti` = id ของแถวใน `StaffSession` ลายเซ็นยังทำหน้าที่เดิม
 * (กันคนปลอม/เดา id ของคนอื่น) แต่ **คำตอบว่า "ยังใช้ได้ไหม" มาจาก DB ทุก request**
 * → ปุ่ม "เตะออกทุกเครื่อง" · รีเซ็ต PIN แล้วใบเก่าตายทันที · ปิดบัญชีแล้วออกทันที
 *
 * ราคาที่จ่าย: query เพิ่มหนึ่งครั้งต่อ request — แต่เดิมก็ query `Staff` ทุก request
 * อยู่แล้ว (เพื่อดูว่าบัญชียัง active ไหม) ตอนนี้รวมเป็น query เดียวที่ join มาให้เลย
 *
 * **cookie เก่าที่ออกก่อนบทที่ 13b ใช้ไม่ได้อีกต่อไป** (ไม่มี `jti`) ทุกคนต้องใส่ PIN
 * ใหม่หนึ่งครั้ง — ตั้งใจให้เป็นแบบนั้น ไม่ทำ fallback เพราะ fallback แปลว่ายังมี
 * ทางเข้าที่ยกเลิกไม่ได้ค้างอยู่ ซึ่งเป็นสิ่งเดียวที่ทั้งบทนี้พยายามปิด
 *
 * **ทุกฟังก์ชันในไฟล์นี้ผูกกับ "หน้าจอ" เสมอ** เพราะ /pos /kds /admin ถือ cookie
 * คนละใบ (เหตุผลเต็มใน lib/staff-session-cookie.ts)
 *
 * รูปแบบค่าใน cookie: base64url(payload).base64url(hmac)
 */
export { STAFF_SESSION_COOKIES, SESSION_TTL_HOURS };

type StaffTokenPayload = {
  /** id ของแถวใน StaffSession — ตัวที่ทำให้ยกเลิกได้ทันที (บทที่ 13b) */
  jti: string;
  /** staffId */
  sid: string;
  /** branchId — ติดมาด้วยเพื่อตรวจว่า cookie กับแถวใน DB พูดตรงกัน */
  bid: string;
  /** วันหมดอายุ (epoch milliseconds) — ชั้นแรกที่ตัดทิ้งได้โดยไม่ต้องแตะ DB */
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

/**
 * ประกอบ token — export เพราะ `scripts/dev-staff-cookie.ts` ต้องออก cookie
 * ให้ curl ใช้ทดสอบ และรูปแบบ token ต้องมีที่เดียวเสมอ ไม่ใช่เขียนซ้ำสองที่
 * แล้ววันหนึ่งแก้ที่นี่ที่เดียวจนเครื่องมือ dev พังเงียบ ๆ
 */
export function createStaffToken(payload: StaffTokenPayload): string {
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

    // ไม่มี jti = cookie รุ่นก่อนบทที่ 13b — ถือว่าใช้ไม่ได้ ไม่ใช่ยอมให้ผ่าน
    if (!payload.jti || payload.exp <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * ล็อกอินด้วยรหัสพนักงาน + PIN แล้วออก session ให้ "หน้าจอนั้นหน้าจอเดียว"
 *
 * ล็อกอินเข้าจอครัวไม่แตะ session ของเครื่อง POS ที่เปิดค้างอยู่ในเบราว์เซอร์
 * เดียวกันเลย และกลับกันด้วย
 */
export async function loginStaff(staffCode: string, pin: string, screen: StaffScreen) {
  const code = staffCode.trim();

  if (!code || !pin) {
    return { ok: false as const, error: "Enter both staff code and PIN" };
  }

  const staff = await prisma.staff.findFirst({
    where: { code, isActive: true },
    include: { branch: true },
  });

  // ข้อความเดียวกันทั้งกรณีไม่มีรหัสนี้และกรณี PIN ผิด เพื่อไม่ให้ใช้หน้าล็อกอิน
  // ไล่เดาว่ารหัสพนักงานไหนมีอยู่จริง
  const invalid = { ok: false as const, error: "Incorrect staff code or PIN" };

  if (!staff) {
    return invalid;
  }

  const throttle = await checkLoginThrottle(staff.branchId, code);

  if (throttle.locked) {
    return {
      ok: false as const,
      error: `Too many failed attempts — try again in ${throttle.minutesLeft} minute(s)`,
    };
  }

  const ipAddress = await clientIp();

  if (!verifyPin(pin, staff.pinHash)) {
    const attempt = await recordFailedLogin(staff.branchId, code);

    // ตารางนี้เขียนอย่างเดียว ห้าม update/delete — เป็นหลักฐานเวลามีคนไล่สุ่ม PIN
    await prisma.auditLog.create({
      data: {
        branchId: staff.branchId,
        staffId: staff.id,
        action: "staff.login_failed",
        entityType: "staff",
        entityId: staff.id,
        ipAddress,
        metadata: {
          staffCode: code,
          screen,
          attempt,
          locked: attempt >= MAX_FAILED_ATTEMPTS,
        },
      },
    });

    return invalid;
  }

  await clearLoginThrottle(staff.branchId, code);

  const session = await createStaffSession({
    staffId: staff.id,
    branchId: staff.branchId,
    screen,
    ipAddress,
  });

  await prisma.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });

  /**
   * บันทึกการเข้าที่ **สำเร็จ** ด้วย ไม่ใช่เฉพาะที่ผิด (spec §26 Login history)
   *
   * ก่อนหน้านี้ log มีแต่ครั้งที่ผิด ซึ่งตอบคำถามสำคัญที่สุดของการสืบสวนไม่ได้เลย:
   * "ตอนที่บิลนั้นถูกยกเลิก ใครล็อกอินอยู่บ้าง" — ครั้งที่สำเร็จคือครั้งที่ทำอะไรได้จริง
   */
  await prisma.auditLog.create({
    data: {
      branchId: staff.branchId,
      staffId: staff.id,
      action: "staff.login",
      entityType: "staff_session",
      entityId: session.id,
      ipAddress,
      metadata: { staffCode: code, screen, role: staff.role },
    },
  });

  // เก็บกวาดของเก่าแบบเงียบ ๆ — ล้มเหลวก็ไม่ควรทำให้การล็อกอินล้มตาม
  void purgeExpiredStaffSessions().catch(() => {});

  const store = await cookies();

  store.set(
    STAFF_SESSION_COOKIES[screen],
    createStaffToken({
      jti: session.id,
      sid: staff.id,
      bid: staff.branchId,
      exp: session.expiresAt.getTime(),
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: session.expiresAt,
    },
  );

  /**
   * จำไว้ว่าใครใช้เครื่องนี้ล่าสุด เพื่อโชว์บนหน้าล็อกจอครั้งถัดไป
   *
   * อยู่คนละ cookie กับ session โดยตั้งใจ เพราะอายุคนละแบบ: session ต้องหมดใน
   * 8 ชั่วโมง (กะเดียว) แต่ชื่อคนล่าสุดต้องอยู่ข้ามกะ — ถ้ายัดรวมกัน พอกดล็อกจอ
   * แล้วชื่อจะหายไปพร้อมกัน ซึ่งคือช่วงเวลาเดียวที่มันมีประโยชน์พอดี
   */
  store.set(
    lastStaffCookieName(screen),
    encodeLastStaff({ name: staff.name, role: staff.role, at: Date.now() }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: LAST_STAFF_TTL_DAYS * 24 * 60 * 60,
    },
  );

  return { ok: true as const, staff, sessionId: session.id };
}

/**
 * ใครใช้เครื่องนี้ล่าสุด — สำหรับแสดงผลบนหน้าล็อกจอเท่านั้น
 *
 * **ห้ามเอาไปใช้ตัดสินใจเรื่องสิทธิ์** ค่านี้ไม่ได้เซ็นลายเซ็นและมาจาก cookie
 * ที่คนหน้าเครื่องแก้เองได้ (ดูเหตุผลเต็มใน lib/last-staff-cookie.ts)
 */
export async function readLastStaffOnDevice(
  screen: StaffScreen,
): Promise<LastStaffOnDevice | null> {
  const store = await cookies();
  return decodeLastStaff(store.get(lastStaffCookieName(screen))?.value);
}

/**
 * ล็อกจอ — ปิด session ของ "หน้าจอนี้" เท่านั้น
 *
 * กดล็อกจอที่เครื่อง POS แล้วจอครัวที่เปิดอยู่อีกแท็บต้องไม่ถูกเตะออกตาม
 * เพราะอาจเป็นคนละคนกด (และที่หน้าร้านจริงคือคนละเครื่อง)
 *
 * ตั้งแต่บทที่ 13b **ต้องปิดแถวใน DB ด้วย ไม่ใช่ลบแต่ cookie** — ไม่งั้นใครที่
 * ก๊อป cookie ออกไปก่อนกดล็อกจอยังใช้ต่อได้จนหมดอายุ
 */
export async function logoutStaff(screen: StaffScreen) {
  const store = await cookies();
  const token = store.get(STAFF_SESSION_COOKIES[screen])?.value;
  const payload = token ? readToken(token) : null;

  if (payload) {
    await revokeStaffSession(payload.jti, { reason: SESSION_REVOKE_REASONS.logout });
  }

  store.delete(STAFF_SESSION_COOKIES[screen]);
}

/**
 * พนักงานที่ล็อกอินอยู่ตอนนี้ — null เมื่อ cookie หาย / ลายเซ็นไม่ผ่าน / หมดอายุ /
 * ถูกยกเลิกไปแล้ว / บัญชีถูกปิด
 *
 * เงื่อนไข "ยังใช้ได้ไหม" ทั้งหมดอยู่ที่ `loadActiveStaffSession()` ที่เดียว
 * ที่นี่ทำแค่แกะ cookie แล้วส่งต่อ
 *
 * `screen` บอกว่าจะอ่าน cookie ใบไหน — **ทุกหน้าจอต้องระบุเสมอ**
 * ละไว้ได้เฉพาะที่เดียวคือ /api/realtime ซึ่งเป็นท่อกลางที่ทุกจอต่อเข้ามา
 * และให้สิทธิ์แค่ "ฟัง event ของสาขาตัวเอง" ไม่ใช่สิทธิ์กดอะไร
 */
export async function getCurrentStaff(screen?: StaffScreen) {
  const store = await cookies();

  const tokens = screen
    ? [store.get(STAFF_SESSION_COOKIES[screen])?.value]
    : ALL_STAFF_SESSION_COOKIES.map((name) => store.get(name)?.value);

  // ใบแรกที่ลายเซ็นผ่านและยังไม่หมดอายุชนะ — ตอนไม่ระบุ screen เราสนใจแค่ว่า
  // "คนนี้เป็นพนักงานของสาขาไหน" ไม่ได้สนใจว่ามาจากจอไหน
  const payload = tokens.reduce<StaffTokenPayload | null>(
    (found, token) => found ?? (token ? readToken(token) : null),
    null,
  );

  if (!payload) {
    return null;
  }

  const session = await loadActiveStaffSession(payload.jti, screen);

  // cookie ต้องพูดตรงกับแถวใน DB ทุกช่อง — ไม่ตรงแม้ช่องเดียวคือของปลอม/ของเก่า
  if (!session || session.staffId !== payload.sid || session.branchId !== payload.bid) {
    return null;
  }

  return session.staff;
}

export type CurrentStaff = NonNullable<Awaited<ReturnType<typeof getCurrentStaff>>>;
