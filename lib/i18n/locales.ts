/**
 * สองภาษาเท่านั้น — เวียดนามเป็นค่าตั้งต้น (ร้านอยู่เวียดนาม)
 *
 * ไม่มีการเดาภาษาจาก Accept-Language และไม่มี region variant (vi-VN/en-US)
 * เพราะคนที่ยืนอยู่หน้าเครื่อง POS เป็นคนเลือกเอง ไม่ใช่เบราว์เซอร์ —
 * แท็บเล็ตในครัวกับโน้ตบุ๊กเจ้าของร้านตั้งคนละภาษาได้โดยไม่ต้องคุยกัน
 */
export const LOCALES = ["vi", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "vi";

/**
 * cookie ที่ผู้ใช้แก้เองได้ จึงต้องตรวจก่อนใช้เสมอ **ห้าม cast**
 *
 * ค่าที่อ่านไม่ออกต้องตกกลับไปเป็นค่าตั้งต้น ไม่ใช่ทำให้เปิดหน้าไม่ได้
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * แท็กภาษาสำหรับ `Intl.DateTimeFormat` — ใช้เฉพาะรูปแบบที่มี **ชื่อเดือน**
 * ("11 thg 9, 2026" / "11 Sept 2026") ซึ่งเป็นคำที่ต้องเปลี่ยนตามปุ่มภาษา
 *
 * ⚠ ใช้ได้เฉพาะที่ render บน server ที่เดียวเท่านั้น — ICU ของ server กับ
 * browser ต่างกันได้ ถ้าเอาไปใช้ใน client component จะเกิด hydration mismatch
 * (เหตุผลเดียวกับที่ formatAmount() ใน lib/money.ts ห้ามใช้ Intl)
 * รูปแบบตัวเลขล้วน (dd/mm/yyyy) ใช้ "en-GB" ต่อได้ เพราะเวียดนามเรียงแบบเดียวกัน
 */
export function intlLocale(locale: Locale): string {
  return locale === "vi" ? "vi-VN" : "en-GB";
}
