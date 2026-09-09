import type { MessageParams } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

/**
 * state ของฟอร์มที่ใช้กับ useActionState — ใช้ร่วมกันทุกหน้าจอ (ลูกค้า/POS/KDS/admin)
 *
 * ต้องอยู่ไฟล์นี้ ไม่ใช่ใน actions.ts — เพราะไฟล์ที่ขึ้นต้นด้วย "use server"
 * export ได้เฉพาะ async function เท่านั้น ถ้าเผลอ export ค่าคงที่ (เช่น object
 * ตั้งต้นของฟอร์ม) ปนไปด้วย Next.js จะ throw ตอนที่ action ถูกเรียกจริง
 * ว่า `A "use server" file can only export async functions, found object.`
 * ซึ่งเป็น error ที่ไม่โผล่ตอน build/typecheck เลย โผล่ตอนกดปุ่มเท่านั้น
 *
 * เป็น discriminated union เพื่อให้ฝั่ง client เช็ค status ตัวเดียว
 * แล้ว TypeScript แคบชนิดให้เองว่ามีข้อความไหม (บทที่ 7)
 *
 * ── ⚠ เก็บ "คีย์" ไม่ใช่ "ประโยค" ───────────────────────────────────────
 * ถ้า action คืนประโยคสำเร็จรูป ข้อความจะค้างอยู่ในภาษาที่เซิร์ฟเวอร์เลือก
 * ตอนนั้น กดสลับภาษาแล้วไม่เปลี่ยนตาม — ปุ่มสลับภาษาจะกลายเป็นคำโกหก
 *
 * ผลพลอยได้ที่สำคัญไม่แพ้กัน: สคริปต์ smoke ตรวจ **คีย์** ซึ่งไม่ขยับเวลาแปล
 * ภาษา — เทสต์ 11 เคสที่พังตอนแปลเป็นอังกฤษ พังเพราะมันไปตรวจประโยคบนจอ
 */
export type FormState =
  | { status: "idle" }
  | { status: "error"; messageKey: MessageKey; params?: MessageParams }
  | { status: "success"; messageKey: MessageKey; params?: MessageParams };

export const IDLE_FORM_STATE: FormState = { status: "idle" };

/**
 * แปลงผลลัพธ์ที่ล้มเหลวจากชั้นธุรกิจให้เป็น FormState
 *
 * มีไว้เพราะฟังก์ชันในชั้นธุรกิจบางตัวคืนรูปที่ **ไม่มี** `params` เลย
 * (ข้อความที่ไม่ต้องแทรกค่า) การเขียน `result.params` ตรง ๆ จึงพังตอน tsc
 * ส่วนพารามิเตอร์ที่เป็น optional ของฟังก์ชันนี้รับได้ทั้งสองแบบ
 */
export function formError(result: {
  errorKey: MessageKey;
  params?: MessageParams;
}): FormState {
  return { status: "error", messageKey: result.errorKey, params: result.params };
}
