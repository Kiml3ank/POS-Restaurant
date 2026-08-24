import "server-only";

/**
 * ช่วงเวลาตาม "วันของสาขา" แปลงเป็น UTC สำหรับใส่ใน where ของ Prisma
 *
 * ── ทำไมยุบมารวมกันตอนนี้ ────────────────────────────────────────────────
 * ตรรกะนี้เคยเป็นสำเนาสองชุดใน `lib/server/receipt.ts` กับ `lib/server/audit.ts`
 * พร้อมคอมเมนต์ว่า "ยังไม่ยุบ รอผู้ใช้รายที่สามที่จะบอกว่ารูปร่างที่ถูกคืออะไร"
 * — Dashboard คือรายที่สาม และสิ่งที่มันต้องการคือ **"ตั้งแต่เที่ยงคืนของสาขา
 * ถึงตอนนี้"** ซึ่งเป็นช่วงวันเหมือนเดิม ไม่ใช่รูปร่างใหม่ จึงยุบได้แล้ว
 *
 * ยังไม่ครอบ "ช่วงกะ" ของบทที่ 15 (ปิดกะตีสองแต่วันยังไม่เปลี่ยน) — ตัวนั้นต้อง
 * อ้างเวลาเปิด/ปิดกะจริงจากตาราง ไม่ใช่คำนวณจากวันที่ **อย่าพยายามยัดเข้ามาที่นี่**
 *
 * ทุกฟังก์ชันคิดจาก offset ของ timezone ณ วินาทีนั้นจริง ๆ จึงถูกทั้งช่วงที่มี
 * daylight saving (ไทยไม่มี แต่สาขาในอนาคตอาจมี)
 */

/** เที่ยงคืนของวัน `YYYY-MM-DD` ตามเวลาสาขา คืนเป็น UTC · undefined เมื่อรูปแบบผิด */
export function startOfBranchDayUtc(
  ymd: string,
  timezone: string,
  addDays = 0,
): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);

  if (!match) {
    return undefined;
  }

  const [, y, m, d] = match;
  const base = Date.UTC(Number(y), Number(m) - 1, Number(d) + addDays);
  return new Date(base - timezoneOffsetMs(new Date(base), timezone));
}

/**
 * ช่วง `from`–`to` (YYYY-MM-DD ตามเวลาสาขา) เป็น `{ gte, lt }` สำหรับ Prisma
 *
 * `to` ถูกขยับไปเที่ยงคืนของ **วันถัดไป** แล้วใช้ `lt` — ไม่ใช่ `lte` ที่ 23:59:59
 * เพราะบิลที่ปิดตอน 23:59:59.500 จะหายไปจากรายงานโดยไม่มีใครสังเกต
 *
 * คืน null เมื่อไม่ได้ระบุอะไรเลย (ผู้เรียกจะได้ไม่ต้องใส่เงื่อนไขวันลงไป)
 */
export function branchDayRangeUtc(
  from: string | null | undefined,
  to: string | null | undefined,
  timezone: string,
): { gte?: Date; lt?: Date } | null {
  const gte = from ? startOfBranchDayUtc(from, timezone) : undefined;
  const lt = to ? startOfBranchDayUtc(to, timezone, 1) : undefined;

  if (!gte && !lt) {
    return null;
  }

  return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
}

/**
 * ช่วง "วันนี้" ของสาขา — ตั้งแต่เที่ยงคืนตามเวลาสาขาถึงเที่ยงคืนวันถัดไป
 *
 * ใช้ `en-CA` หา YYYY-MM-DD ของวันนี้ก่อน (ท่าเดียวกับ `branchDayKey()` ที่
 * `orderNumber`/เลขคิวใช้) เพื่อให้ "วันนี้" ของ Dashboard ตรงกับ "วันนี้" ที่
 * เลขบิลใช้เสมอ — ไม่งั้นตอนตีหนึ่งจะมีบิลที่นับอยู่คนละวันกับเลขที่พิมพ์บนใบ
 */
export function branchTodayRangeUtc(timezone: string, at: Date = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);

  return {
    ymd,
    gte: startOfBranchDayUtc(ymd, timezone) as Date,
    lt: startOfBranchDayUtc(ymd, timezone, 1) as Date,
  };
}

function timezoneOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");

  return (
    Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    ) - at.getTime()
  );
}
