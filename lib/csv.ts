import type { Currency } from "@/lib/generated/prisma/enums";

/**
 * ประกอบ CSV ที่ Excel เปิดแล้วไม่เพี้ยน (spec §19)
 *
 * ── ทำไมต้องมี BOM ──────────────────────────────────────────────────────
 * Excel เดา encoding ของไฟล์ .csv จาก codepage ของเครื่อง ไม่ใช่ UTF-8 —
 * ชื่อเมนูภาษาเวียดนามจะกลายเป็นอักษรขยะทันทีถ้าไม่มี BOM นำหน้า
 * (ผู้ใช้จะสรุปว่า "ระบบพัง" ไม่ใช่ "Excel เดาผิด")
 *
 * ── ทำไม CRLF ───────────────────────────────────────────────────────────
 * RFC 4180 กำหนดไว้ และ Excel รุ่นเก่าบน Windows อ่าน LF เดี่ยวเป็นบรรทัดเดียวยาว ๆ
 */
const BOM = "﻿";

function escapeCell(value: string | number | null): string {
  if (value === null) {
    return "";
  }

  if (typeof value === "number") {
    return String(value);
  }

  // ครอบด้วยเครื่องหมายคำพูดเมื่อมีตัวที่ทำให้ผู้อ่านแยกช่องผิด และหนี " เป็น ""
  return /[",\r\n]/.test(value) ? `"${value.split('"').join('""')}"` : value;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return BOM + rows.map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * ชื่อไฟล์ที่บอกได้ว่าเป็นรายงานอะไรของช่วงไหน โดยไม่ต้องเปิดดู
 *
 * ปลอดภัยกับ header `Content-Disposition` เพราะเหลือแต่ `a-z0-9-_.` เท่านั้น
 */
export function csvFileName(type: string, range: { fromDay: string; toDay: string }): string {
  const safe = `report-${type}-${range.fromDay}-${range.toDay}.csv`;
  return safe.replace(/[^A-Za-z0-9._-]/g, "-");
}

/**
 * หัวคอลัมน์ของยอดเงิน — บอกสกุลไว้ในชื่อคอลัมน์ เพราะตัวเลขในไฟล์เป็น
 * **จำนวนเต็มหน่วยย่อยดิบ** ไม่ได้จัดรูป (สเปรดชีตต้องบวกคอลัมน์นี้ได้)
 */
export function amountHeader(label: string, currency: Currency): string {
  return `${label} (${currency})`;
}
