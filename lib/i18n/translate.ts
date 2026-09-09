import type { Dictionary, MessageKey } from "./vi";

export type MessageParams = Record<string, string | number>;

/**
 * คีย์ที่มีรูปเอกพจน์/พหูพจน์ — ดึงจากคีย์ที่ลงท้ายด้วย ".one" อัตโนมัติ
 *
 * เพิ่มคู่ `.one`/`.other` ใน vi.ts แล้วคีย์ฐานจะใช้กับ tCount() ได้ทันที
 * โดยไม่ต้องมาขึ้นทะเบียนซ้ำที่นี่ — และคีย์ที่ไม่มีคู่จะถูก tsc ปฏิเสธ
 */
export type CountKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? Base : never;
}[MessageKey];

/**
 * แทนที่ {token} ด้วยค่าใน params
 *
 * token ที่ไม่มีใน params จะถูกปล่อยไว้ตามเดิม **ไม่ throw** — ป้ายที่เขียนผิด
 * ต้องทำให้เห็นข้อความแปลก ๆ หนึ่งบรรทัด ไม่ใช่ทำให้ทั้งจอ 500
 * (จอครัวที่ดับเพราะป้ายพิมพ์ผิดคือความเสียหายที่ใหญ่กว่าป้ายที่อ่านแปลก ๆ)
 */
export function translate(
  dict: Dictionary,
  key: MessageKey,
  params?: MessageParams,
): string {
  const template = dict[key];

  if (params === undefined) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/**
 * เลือกรูปตามจำนวน — เวียดนามใช้รูปเดียวทั้งคู่ อังกฤษต้องแยก
 *
 * มีไว้เพื่อเลิกเขียน "try again in 5 minute(s)" ซึ่งเป็นสิ่งที่โค้ดทำอยู่ก่อนหน้านี้
 *
 * `count` ถูกใส่ให้ใน params เสมอ จึงเขียน "{count} bills" ได้โดยไม่ต้องส่งเอง
 * และวางไว้ **ก่อน** ...params เพื่อให้ผู้เรียกทับค่าได้ถ้าอยากจัดรูปเลขเอง
 */
export function tCount(
  dict: Dictionary,
  base: CountKey,
  n: number,
  params?: MessageParams,
): string {
  return translate(dict, countKey(base, n), { count: n, ...params });
}

/**
 * เลือกคีย์เอกพจน์/พหูพจน์โดยไม่แปล — สำหรับ **ชั้นธุรกิจ**
 *
 * `lib/server/*` คืนคีย์ ไม่ได้คืนประโยค แต่มันเป็นฝ่ายที่ "รู้จำนวน" อยู่แล้ว
 * จึงเลือกรูปที่ถูกให้เลย แล้วหน้าจอเรียก `t(key, params)` แบบเดิมได้โดยไม่ต้อง
 * รู้ว่าคีย์นี้มีพหูพจน์หรือเปล่า — ไม่งั้น FormState ต้องแบกข้อมูลเพิ่มว่า
 * "คีย์นี้ต้องเรียก tc() นะ" ซึ่งเป็นสถานะที่ลืมส่งได้
 */
export function countKey(base: CountKey, n: number): MessageKey {
  return (n === 1 ? `${base}.one` : `${base}.other`) as MessageKey;
}
