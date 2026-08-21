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
 * แล้ว TypeScript แคบชนิดให้เองว่ามี message ไหม (บทที่ 7)
 */
export type FormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

export const IDLE_FORM_STATE: FormState = { status: "idle" };
