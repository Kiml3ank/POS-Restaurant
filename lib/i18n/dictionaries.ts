import { en } from "./en";
import type { Locale } from "./locales";
import { vi, type Dictionary } from "./vi";

/**
 * ตารางภาษา → พจนานุกรม
 *
 * ทั้งสองภาษาถูก import ตรงนี้โดยตั้งใจ (ไม่ใช่ dynamic import) เพราะ provider
 * ฝั่ง client เลือกจากตารางนี้ ทำให้ข้อความทั้งสองภาษาอยู่ใน chunk เดียวที่
 * เบราว์เซอร์แคชครั้งเดียวจบ
 *
 * ทางเลือกที่ไม่เอา: ส่งพจนานุกรมเป็น prop จาก server — แบบนั้นมันจะถูก
 * serialize ลง RSC payload ใหม่ **ทุกครั้งที่เปลี่ยนหน้า** ซึ่งจอ POS ทำทั้งวัน
 *
 * ประกาศเป็น `Record<Locale, Dictionary>` เพื่อให้ tsc ฟ้องเองถ้าเพิ่มภาษา
 * ใน LOCALES แล้วลืมมาเพิ่มพจนานุกรมที่นี่ (ท่าเดียวกับ Record<StaffScreen, string>)
 */
export const DICTIONARIES: Record<Locale, Dictionary> = { vi, en };
