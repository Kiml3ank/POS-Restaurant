import type { MessageKey } from "@/lib/i18n/vi";

/**
 * ช่วงวันของรายงาน (spec §5)
 *
 * ── ทำไมเป็นสตริง ไม่ใช่ Date ────────────────────────────────────────────
 * การแปลง "วันของสาขา" เป็น UTC อยู่ที่ `lib/server/branch-time.ts` ซึ่งมี
 * `import "server-only"` — ถ้าไฟล์นี้คืน Date มันจะต้อง import ตัวนั้นแล้ว
 * หน้าจอกับ route handler จะ import ไฟล์นี้ร่วมกันไม่ได้อีก
 *
 * ไฟล์นี้จึงเป็น **เลขคณิตวันที่ล้วน** ส่วนการแปลงเป็นช่วง UTC เกิดฝั่ง server
 * ด้วย `branchDayRangeUtc(range.fromDay, range.toDay, branch.timezone)`
 */
export type ReportRange = { fromDay: string; toDay: string };

export const REPORT_PRESETS = ["today", "yesterday", "last7", "month"] as const;

export type ReportPreset = (typeof REPORT_PRESETS)[number];

/**
 * เพดานความกว้างของช่วง
 *
 * รายงานดึงแถว `Payment` ทั้งช่วงมาจัดกลุ่มในหน่วยความจำ (ดูเหตุผลใน spec §4.3)
 * 92 วัน ≈ หนึ่งไตรมาส ซึ่งครอบการใช้งานจริงของร้านเดียว — กว้างกว่านี้ต้อง
 * ย้ายการจัดกลุ่มไปทำใน SQL ก่อน **ห้ามแค่เพิ่มตัวเลขนี้เฉย ๆ**
 */
export const MAX_REPORT_DAYS = 92;

const DAY_MS = 24 * 60 * 60 * 1000;

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** บวกวันแบบปฏิทิน โดยคิดที่ UTC เพื่อไม่ให้เขตเวลาของเครื่องมายุ่ง */
function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(fromDay: string, toDay: string): number {
  return (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS + 1;
}

function isPreset(value: unknown): value is ReportPreset {
  return typeof value === "string" && (REPORT_PRESETS as readonly string[]).includes(value);
}

function fromPreset(preset: ReportPreset, todayYmd: string): ReportRange {
  switch (preset) {
    case "today":
      return { fromDay: todayYmd, toDay: todayYmd };
    case "yesterday": {
      const day = addDays(todayYmd, -1);
      return { fromDay: day, toDay: day };
    }
    case "last7":
      // นับรวมวันนี้ → ถอยหลัง 6 วัน ไม่ใช่ 7 (ไม่งั้นได้ 8 วัน)
      return { fromDay: addDays(todayYmd, -6), toDay: todayYmd };
    case "month":
      return { fromDay: `${todayYmd.slice(0, 7)}-01`, toDay: todayYmd };
  }
}

/**
 * แปลง query string เป็นช่วงที่ใช้ได้จริง
 *
 * `preset` ชนะ `from`/`to` เมื่อส่งมาทั้งคู่ — ปุ่ม preset บนหน้าจอเขียน URL ใหม่
 * ทั้งชุดอยู่แล้ว การมีทั้งสองอย่างจึงแปลว่าผู้ใช้เพิ่งกดปุ่ม
 *
 * **ค่าที่อ่านไม่ออกต้องเป็น error ที่บอกได้ ไม่ใช่ตกกลับเงียบ ๆ** — ต่างจาก
 * cookie ภาษาที่ตกกลับได้ เพราะตรงนี้ผู้ใช้ตั้งใจถามถึงช่วงหนึ่ง การเงียบ ๆ
 * ตอบอีกช่วงแล้วเขาอ่านเป็นตัวเลขของช่วงที่ขอคือความเสียหายจริง
 */
export function resolveReportRange(params: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  todayYmd: string;
}): { ok: true; range: ReportRange } | { ok: false; errorKey: MessageKey } {
  if (isPreset(params.preset)) {
    return { ok: true, range: fromPreset(params.preset, params.todayYmd) };
  }

  if (!params.from && !params.to) {
    return { ok: true, range: fromPreset("last7", params.todayYmd) };
  }

  const fromDay = params.from ?? "";
  const toDay = params.to ?? "";

  if (!isYmd(fromDay) || !isYmd(toDay)) {
    return { ok: false, errorKey: "error.report_range_invalid" };
  }

  if (fromDay > toDay) {
    return { ok: false, errorKey: "error.report_range_invalid" };
  }

  if (daysBetween(fromDay, toDay) > MAX_REPORT_DAYS) {
    return { ok: false, errorKey: "error.report_range_too_long" };
  }

  return { ok: true, range: { fromDay, toDay } };
}
