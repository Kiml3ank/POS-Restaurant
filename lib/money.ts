import type { Currency } from "@/lib/generated/prisma/enums";

/**
 * เงินในระบบนี้เก็บเป็น **จำนวนเต็มของ "หน่วยย่อยที่สุด" ของสกุลเงินนั้น** เสมอ
 * ห้ามใช้ float เด็ดขาด (CLAUDE.md หัวข้อ 4)
 *
 * ── สิ่งที่ต้องเข้าใจก่อนแตะไฟล์นี้ ──────────────────────────────────────
 * เลข `6000` ในคอลัมน์ราคา **ไม่ได้แปลว่า 60.00 เสมอไป** — มันแปลว่าอะไร
 * ขึ้นกับสกุลเงินของสาขานั้น:
 *
 *   สาขาไทย (THB)      6000 = 60.00 บาท      (100 สตางค์ = 1 บาท)
 *   สาขาลาว (LAK)      6000 = 6,000 กีบ       (ไม่มีหน่วยย่อย)
 *   สาขาเวียดนาม (VND) 6000 = 6.000 ₫         (ไม่มีหน่วยย่อย)
 *
 * เพราะฉะนั้น **ห้ามหารด้วย 100 ที่ไหนก็ตามนอกไฟล์นี้** และห้ามเขียน "฿" ลง
 * ในหน้าจอตรง ๆ ทุกที่ที่จะแสดงเงินต้องเรียก `formatMoney()` พร้อมสกุลเงินของสาขา
 *
 * ── ทำไม LAK กับ VND ถึงไม่มีทศนิยม ─────────────────────────────────────
 * VND: ISO 4217 กำหนดหน่วยย่อยเป็น 0 อยู่แล้ว (hào/xu เลิกใช้ไปนานแล้ว)
 * LAK: ISO 4217 ยังระบุ att ไว้เป็นหน่วยย่อย แต่ **att ไม่มีหมุนเวียนจริงแล้ว**
 *      ร้านค้าในลาวตั้งราคาเป็นกีบเต็มจำนวนทั้งหมด การเก็บทศนิยมไว้จึงมีแต่
 *      จะทำให้พนักงานกรอกราคาผิดหลักร้อยเท่า (พิมพ์ 50000 คิดว่า 50,000 กีบ
 *      แต่ระบบอ่านเป็น 500 กีบ) — จึงตั้งเป็น 0 ตามการใช้งานจริง
 *      ถ้าวันหนึ่งต้องใช้ att จริง ๆ ให้แก้ `decimals` ของ LAK ที่เดียวในตารางล่าง
 *      **แล้วต้องแปลงข้อมูลราคาที่มีอยู่ทั้งหมดด้วย migration ห้ามแก้เฉย ๆ**
 *
 * ไฟล์นี้ไม่มี `import "server-only"` เพราะ client component ที่แสดงราคาในตะกร้า
 * ต้องเรียกใช้ได้ด้วย จึงต้องไม่แตะ Prisma หรือ process.env ใด ๆ ในไฟล์นี้
 * (import ข้างบนเป็น `import type` ล้วน ไม่มีโค้ดจริงติดไปฝั่ง client)
 */

export type CurrencyConfig = {
  /** จำนวนทศนิยมที่แสดง = จำนวนหลักของ "หน่วยย่อย" ต่อหนึ่งหน่วยใหญ่ */
  decimals: 0 | 2;
  symbol: string;
  /** สัญลักษณ์อยู่หน้าตัวเลขหรือหลัง — เวียดนามเขียน "6.000 ₫" ไม่ใช่ "₫6.000" */
  symbolPosition: "before" | "after";
  /** ตัวคั่นหลักพัน */
  group: string;
  /** ตัวคั่นทศนิยม (ไม่ได้ใช้เมื่อ decimals = 0) */
  decimal: string;
  /** ชื่อที่คนอ่านออก ใช้ในหน้าตั้งค่า/รายงาน */
  label: string;
};

/**
 * ตารางสกุลเงิน — **ต้องมีครบทุกสมาชิกของ enum `Currency` ใน schema.prisma**
 *
 * ประกาศเป็น `Record<Currency, ...>` โดยตั้งใจ: วันที่มีคนเพิ่มสกุลเงินใน schema
 * แล้วลืมมาเพิ่มที่นี่ `tsc` จะฟ้องทันที ไม่ต้องรอไปเจอตอนเปิดหน้าจอของสาขานั้น
 */
export const CURRENCIES: Record<Currency, CurrencyConfig> = {
  THB: {
    decimals: 2,
    symbol: "฿",
    symbolPosition: "before",
    group: ",",
    decimal: ".",
    label: "บาท",
  },
  LAK: {
    decimals: 0,
    symbol: "₭",
    symbolPosition: "before",
    group: ",",
    decimal: ".",
    label: "กีบ",
  },
  VND: {
    // เวียดนามใช้จุดคั่นหลักพัน ไม่ใช่จุลภาค — "6.000 ₫" คือหกพันดอง ไม่ใช่หกดอง
    decimals: 0,
    symbol: "₫",
    symbolPosition: "after",
    group: ".",
    decimal: ",",
    label: "ดอง",
  },
};

/** จำนวนหน่วยย่อยต่อหนึ่งหน่วยใหญ่ เช่น THB → 100, VND → 1 */
export function minorUnitsPerMajor(currency: Currency): number {
  return CURRENCIES[currency].decimals === 2 ? 100 : 1;
}

/**
 * แปลงจำนวนเต็มหน่วยย่อยเป็นสตริงตัวเลข **ไม่มีสัญลักษณ์สกุลเงิน**
 *
 * ใช้การหาร/มอดของจำนวนเต็มล้วนและประกอบสตริงเอง ไม่ผ่าน float และไม่ผ่าน
 * `toLocaleString` ของ Intl เพราะ Intl ผูกกับ locale ของเครื่องที่รัน ซึ่งบน
 * server กับบน browser ของลูกค้าอาจไม่ตรงกัน แล้วจะเกิด hydration mismatch
 * ที่โผล่เป็น "ราคากะพริบเปลี่ยนเลข" ตอนหน้าโหลดเสร็จ
 */
export function formatAmount(amount: number, currency: Currency): string {
  const config = CURRENCIES[currency];
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(amount));

  const perMajor = minorUnitsPerMajor(currency);
  const major = Math.floor(abs / perMajor);
  const minor = abs % perMajor;

  const grouped = groupDigits(String(major), config.group);

  if (config.decimals === 0) {
    return `${sign}${grouped}`;
  }

  return `${sign}${grouped}${config.decimal}${String(minor).padStart(config.decimals, "0")}`;
}

/** ใส่ตัวคั่นหลักพันจากขวาไปซ้ายทีละสามหลัก */
function groupDigits(digits: string, separator: string): string {
  let out = "";

  for (let index = 0; index < digits.length; index += 1) {
    // ตำแหน่งนับจากขวา: ใส่ตัวคั่นทุก ๆ 3 หลักแต่ไม่ใส่หน้าสุด
    const fromRight = digits.length - index;
    out += digits[index];

    if (fromRight > 1 && (fromRight - 1) % 3 === 0) {
      out += separator;
    }
  }

  return out;
}

/**
 * เงินพร้อมสัญลักษณ์สกุลเงิน เช่น
 *   THB 12000 → "฿120.00"
 *   LAK 120000 → "₭120,000"
 *   VND 120000 → "120.000 ₫"
 */
export function formatMoney(amount: number, currency: Currency): string {
  const config = CURRENCIES[currency];
  const formatted = formatAmount(amount, currency);

  if (config.symbolPosition === "after") {
    // เครื่องหมายลบต้องอยู่หน้าตัวเลขเสมอ ไม่ใช่หน้าสัญลักษณ์ที่อยู่ท้าย
    return `${formatted} ${config.symbol}`;
  }

  return formatted.startsWith("-")
    ? `-${config.symbol}${formatted.slice(1)}`
    : `${config.symbol}${formatted}`;
}

/**
 * อ่านจำนวนเงินที่ "คนพิมพ์" แล้วแปลงเป็นจำนวนเต็มหน่วยย่อย — คืน null ถ้าอ่านไม่ออก
 *
 * ใช้ที่ช่อง "รับเงินสดมาเท่าไหร่" (บทที่ 11) ซึ่งพนักงานพิมพ์เป็นหน่วยใหญ่ตามที่
 * เขียนอยู่บนแบงก์ ("1000" = หนึ่งพันบาท ไม่ใช่สิบบาท) และที่ช่องราคาเมนู/
 * ส่วนต่างราคาตัวเลือกในหลังร้าน (โมดูล 04)
 *
 * **รับเลขติดลบด้วย** เพราะ `Modifier.priceDelta` ติดลบได้โดยตั้งใจ
 * ("ไม่เอาเนื้อ −10 บาท") — ส่วนช่องที่ห้ามติดลบ (เช่น `MenuItem.basePrice`)
 * ต้องตรวจที่ชั้นบน ไม่ใช่มาตรวจในตัวแปลงนี้ เพราะตัวแปลงไม่รู้ว่ากำลังอ่านค่าอะไรอยู่
 *
 * ── ทำไมไม่ใช้ `Number(text) * 100` ──────────────────────────────────────
 * เพราะนั่นคือ float: `19.99 * 100 === 1998.9999999999998` แล้วพอ trunc
 * จะได้ 1998 — เงินหายไปหนึ่งสตางค์แบบที่หาสาเหตุไม่เจอ ที่นี่จึงแยกสตริงที่จุด
 * ทศนิยมแล้วประกอบเป็นจำนวนเต็มตรง ๆ ไม่มีการคูณ/หารทศนิยมเลย
 *
 * รับตัวคั่นหลักพันของสกุลนั้นได้ด้วย (พนักงานที่ก๊อปยอดมาวางจะติดตัวคั่นมา)
 * และสำหรับสกุลที่ไม่มีทศนิยม (LAK/VND) ส่วนที่พิมพ์หลังจุดจะถูกทิ้ง
 */
export function parseMoneyInput(text: string, currency: Currency): number | null {
  const config = CURRENCIES[currency];
  // ลบตัวคั่นหลักพันของสกุลนั้นและช่องว่างทิ้งก่อน ที่เหลือต้องเป็นตัวเลขล้วน
  const cleaned = text
    .trim()
    .split(config.group)
    .join("")
    .replace(/\s/g, "");

  if (cleaned === "") {
    return null;
  }

  // แยกเครื่องหมายลบออกก่อนแล้วค่อยอ่านตัวเลข — ไม่งั้น "-10.50" จะต้องมีกฎ regex
  // ที่ซับซ้อนขึ้นทั้งสองที่ (ทั้งส่วนจำนวนเต็มและส่วนทศนิยม) โดยไม่จำเป็น
  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;

  if (unsigned === "") {
    return null;
  }

  const [majorText, minorText = ""] = unsigned.split(config.decimal);

  if (!/^\d+$/.test(majorText) || (minorText !== "" && !/^\d+$/.test(minorText))) {
    return null;
  }

  const major = Number.parseInt(majorText, 10);

  if (!Number.isSafeInteger(major)) {
    return null;
  }

  const sign = negative ? -1 : 1;

  if (config.decimals === 0) {
    return sign * major;
  }

  // เติม/ตัดให้เหลือจำนวนหลักของหน่วยย่อยพอดี ("1.5" → 50 สตางค์ · "1.005" → 0 สตางค์)
  const minor = Number.parseInt(minorText.padEnd(config.decimals, "0").slice(0, config.decimals) || "0", 10);

  // คูณเครื่องหมายที่ "ยอดรวมหน่วยย่อย" ครั้งเดียว ไม่ใช่คูณแยกส่วนใหญ่กับส่วนย่อย
  // — ไม่งั้น "-0.50" จะได้ (-0 × 100) + 50 = 50 ซึ่งกลับเครื่องหมายหายไปเงียบ ๆ
  return sign * (major * minorUnitsPerMajor(currency) + minor);
}

/** ส่วนต่างราคาของตัวเลือก แสดงเครื่องหมายเสมอ เช่น "+฿15.00" · "-5.000 ₫" */
export function formatMoneyDelta(amount: number, currency: Currency): string {
  if (amount === 0) {
    return "";
  }

  return amount > 0 ? `+${formatMoney(amount, currency)}` : formatMoney(amount, currency);
}

/**
 * ราคาหนึ่งบรรทัดในบิล = (ราคาต่อหน่วย + ส่วนต่าง modifier รวม) × จำนวน
 *
 * เป็นเลขจำนวนเต็มล้วน จึงใช้ได้กับทุกสกุลเงินโดยไม่ต้องรู้ว่าเป็นสกุลไหน
 * แยกออกมาเป็นฟังก์ชันเพื่อให้ทั้งตะกร้า (บทที่ 7) และหน้า POS (บทที่ 9)
 * คิดด้วยสูตรเดียวกันเป๊ะ ๆ ไม่ต้องเขียนซ้ำสองที่แล้วเพี้ยนกัน
 */
export function lineTotalOf(unitPrice: number, modifierTotal: number, quantity: number): number {
  return (unitPrice + modifierTotal) * quantity;
}
