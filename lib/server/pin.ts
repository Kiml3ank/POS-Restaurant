import "server-only";

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * PIN ของพนักงาน (บทที่ 13 ส่วนที่ดึงมาทำก่อนเพราะ POS บทที่ 9 ต้องรู้ว่าใครกด)
 *
 * ทำไมเป็น PIN สั้น ไม่ใช่รหัสผ่าน: หน้าร้านต้องกดสลับคนได้ในไม่กี่วินาที
 * ราคาที่จ่ายคือ PIN 4 หลักเดาได้ง่าย จึงต้องคู่กับสองอย่างเสมอ
 *   1. จำกัดจำนวนครั้งที่กรอกผิด (ดู lib/server/staff-session.ts)
 *   2. บันทึก AuditLog ทุกครั้งที่กรอกผิด เพื่อให้ย้อนดูได้ว่ามีคนสุ่ม PIN ไหม
 *
 * เก็บเป็น scrypt ที่ Node มีมาให้ในตัว ไม่ต้องเพิ่ม dependency
 * รูปแบบที่เก็บลง Staff.pinHash: "scrypt$<saltHex>$<hashHex>"
 *
 * ไฟล์นี้ถูกเรียกจาก prisma/seed.ts ด้วย จึงต้องรัน seed ด้วย
 * `tsx --conditions=react-server` (ตั้งไว้ใน prisma.config.ts แล้ว)
 * ไม่งั้น `import "server-only"` จะ throw
 */
const KEY_LENGTH = 64;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * เทียบ PIN กับ hash ที่เก็บไว้
 *
 * ใช้ timingSafeEqual ไม่ใช่ === เพราะการเทียบสตริงปกติจะหยุดที่ตัวอักษรแรกที่ต่างกัน
 * เวลาที่ใช้จึงบอกใบ้ได้ว่าเดาถูกไปกี่ตัว (timing attack)
 */
export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");

  if (scheme !== "scrypt" || !saltHex || !hashHex) {
    return false;
  }

  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
