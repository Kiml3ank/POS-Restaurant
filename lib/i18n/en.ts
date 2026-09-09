import type { Dictionary } from "./vi";

/**
 * ข้อความอังกฤษ
 *
 * ประกาศชนิดเป็น `Dictionary` ไม่ใช่ `as const` โดยตั้งใจ — ชนิดนี้บังคับให้
 * มีคีย์ครบเท่ากับ vi.ts เป๊ะ ๆ: ขาดหนึ่งคีย์ tsc ฟ้อง เกินหนึ่งคีย์ก็ฟ้อง
 * (excess property check) เพราะฉะนั้น "แปลตกหล่น" กลายเป็น build error
 * ไม่ใช่บั๊กที่ไปโผล่บนจอลูกค้าเป็นคีย์ดิบ
 *
 * ⚠ ห้ามเพิ่ม `as Dictionary` หรือ `satisfies` ที่ปิดการตรวจนี้เด็ดขาด
 */
export const en: Dictionary = {
  // ── ทั่วไป ────────────────────────────────────────────────────────────
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.back": "Back",
  "common.close": "Close",
  "common.search": "Search",
  "common.language": "Language",

  // ── สถานะบิล ──────────────────────────────────────────────────────────
  "orderStatus.DRAFT": "Cart",
  "orderStatus.PLACED": "Sent to kitchen",
  "orderStatus.IN_PROGRESS": "Preparing",
  "orderStatus.READY": "Ready to serve",
  "orderStatus.SERVED": "Served",
  "orderStatus.PAID": "Paid",
  "orderStatus.CANCELLED": "Cancelled",

  // ── สถานะรายการในบิล ──────────────────────────────────────────────────
  "orderItemStatus.DRAFT": "In cart",
  "orderItemStatus.PLACED": "Awaiting kitchen",
  "orderItemStatus.IN_PROGRESS": "Preparing",
  "orderItemStatus.READY": "Ready to serve",
  "orderItemStatus.SERVED": "Served",
  "orderItemStatus.CANCELLED": "Cancelled",

  // ── ปุ่มของจอครัว (KDS) ───────────────────────────────────────────────
  "kitchenAction.PLACED": "Start cooking",
  "kitchenAction.IN_PROGRESS": "Mark ready",

  // ── วิธีชำระเงิน ──────────────────────────────────────────────────────
  "paymentMethod.CASH": "Cash",
  "paymentMethod.QR": "QR",
  "paymentMethod.CARD": "Card",

  // ── ช่องทางขาย ────────────────────────────────────────────────────────
  "salePoint.DINE_IN": "Dine-in",
  "salePoint.COUNTER": "Takeaway",
  "salePoint.DELIVERY": "Delivery",
  "salePoint.tableNamed": "Table {name}",
  "salePoint.queued": "{channel} #{queue}",
  "salePoint.channelNamed": "{channel} · {name}",
  "salePoint.fieldTable": "Table",
  "salePoint.fieldChannel": "Channel",

  // ── สกุลเงิน ──────────────────────────────────────────────────────────
  "currency.THB": "Baht",
  "currency.LAK": "Kip",
  "currency.VND": "Dong",

  // ── ข้อความผิดพลาดที่ action คืนออกมา ─────────────────────────────────
  "error.session_expired": "Session expired — please enter your PIN again",
  "error.not_allowed": "You do not have permission to do that",
  "error.bad_pin": "Incorrect staff code or PIN",
  "error.locked_out.one": "Too many failed attempts — try again in {count} minute",
  "error.locked_out.other": "Too many failed attempts — try again in {count} minutes",

  // ── ตัวสลับภาษา — ชื่อภาษาเขียนด้วยภาษานั้นเองเสมอ ไม่แปล ──────────────
  "locale.vi": "Tiếng Việt",
  "locale.en": "English",
};
