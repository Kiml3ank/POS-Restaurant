/**
 * เงินในระบบนี้เก็บเป็นจำนวนเต็มหน่วย "สตางค์" ทุกจุด ห้ามใช้ float เด็ดขาด
 * (CLAUDE.md หัวข้อ 4) — 12000 = 120.00 บาท
 *
 * ไฟล์นี้ไม่มี `import "server-only"` เพราะ client component ที่แสดงราคาในตะกร้า
 * ต้องเรียกใช้ได้ด้วย จึงต้องไม่แตะ Prisma หรือ process.env ใด ๆ ในไฟล์นี้
 *
 * ตัวคำนวณบิลเต็ม (service charge → VAT) อยู่ในบทที่ 10 คนละไฟล์กัน
 * ที่นี่มีแค่การ "แสดงผล" กับการบวกคูณระดับบรรทัดเท่านั้น
 */

/** 100 สตางค์ = 1 บาท */
export const SATANG_PER_BAHT = 100;

/**
 * แปลงสตางค์เป็นสตริงบาททศนิยม 2 ตำแหน่ง เช่น 12000 → "120.00", -1000 → "-10.00"
 * ใช้การหาร/มอดของจำนวนเต็มล้วน ไม่ผ่าน float เพื่อไม่ให้เจอปัญหาปัดเศษ
 */
export function formatSatang(satang: number): string {
  const sign = satang < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(satang));
  const baht = Math.floor(abs / SATANG_PER_BAHT);
  const remainder = abs % SATANG_PER_BAHT;

  return `${sign}${baht.toLocaleString("th-TH")}.${String(remainder).padStart(2, "0")}`;
}

/** เหมือน formatSatang แต่มีสัญลักษณ์สกุลเงินนำหน้า เช่น 12000 → "฿120.00" */
export function formatBaht(satang: number): string {
  const formatted = formatSatang(satang);
  return formatted.startsWith("-") ? `-฿${formatted.slice(1)}` : `฿${formatted}`;
}

/** ส่วนต่างราคาของตัวเลือก แสดงเครื่องหมายเสมอ เช่น +฿15.00 / -฿10.00 / ไม่คิดเพิ่ม */
export function formatPriceDelta(satang: number): string {
  if (satang === 0) return "";
  return satang > 0 ? `+${formatBaht(satang)}` : formatBaht(satang);
}

/**
 * ราคาหนึ่งบรรทัดในบิล = (ราคาต่อหน่วย + ส่วนต่าง modifier รวม) × จำนวน
 * แยกออกมาเป็นฟังก์ชันเพื่อให้ทั้งตะกร้า (บทที่ 7) และหน้า POS (บทที่ 9)
 * คิดด้วยสูตรเดียวกันเป๊ะ ๆ ไม่ต้องเขียนซ้ำสองที่แล้วเพี้ยนกัน
 */
export function lineTotalOf(unitPrice: number, modifierTotal: number, quantity: number): number {
  return (unitPrice + modifierTotal) * quantity;
}
