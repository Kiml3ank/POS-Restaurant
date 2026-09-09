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
