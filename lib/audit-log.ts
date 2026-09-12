/**
 * ป้ายและตัวสรุปของ AuditLog (บทที่ 13)
 *
 * **ไม่มี `import "server-only"`** เพราะหน้าอ่าน log ใช้แสดงผล — แบบเดียวกับ
 * `lib/order-status.ts` และ `lib/payment-method.ts`
 *
 * ── กฎเหล็กของไฟล์นี้: ห้ามซ่อนแถวที่ไม่รู้จัก ────────────────────────────
 * `AuditLog.metadata` เป็น `Json` ที่รูปร่างต่างกันไปตาม action และจะมี action
 * ใหม่เพิ่มเข้ามาทุกบทที่ทำต่อจากนี้ ตัวแปลจึงต้องมี **fallback ที่แสดง JSON ดิบ
 * เสมอ** ไม่ใช่ throw หรือคืนค่าว่าง
 *
 * เหตุผล: ตารางนี้เขียนอย่างเดียวและมีไว้เพื่อ "ตอบให้ได้ว่าเกิดอะไรขึ้น"
 * แถวที่หายไปจากหน้าจอเพราะโค้ดยังไม่รู้จัก action นั้น **แย่กว่าแถวที่อ่านยาก**
 * — คนที่กำลังสืบสวนจะสรุปว่าไม่มีเหตุการณ์นั้นเกิดขึ้น ซึ่งผิด
 */

import type { MessageKey } from "@/lib/i18n/vi";

/**
 * action → คีย์ข้อความ
 *
 * ⚠ **ห้ามซ่อนแถวที่ไม่รู้จักเด็ดขาด** — action ที่ยังไม่มีในตารางนี้ต้องแสดง
 * ชื่อดิบออกมา ไม่ใช่หายไปจากจอ คนสืบสวนที่ไม่เห็นแถวจะสรุปว่าไม่มีเหตุการณ์นั้น
 * ซึ่งผิด (กติกาตั้งแต่บทที่ 13a) — ตัวที่บังคับกฎนี้คือ `auditActionKey()`
 * ที่คืน null ไม่ใช่คีย์ของคำว่า "ไม่ทราบ"
 */
const AUDIT_ACTION_KEYS: Record<string, MessageKey> = {
  "payment.take": "audit.action.payment_take",
  "order_item.cancel": "audit.action.order_item_cancel",
  "table_session.abandon": "audit.action.session_abandon",
  "table_session.move": "audit.action.session_move",
  "table_session.merge": "audit.action.session_merge",
  "staff.login_failed": "audit.action.staff_login_failed",
  "menu.item.upsert": "audit.action.menu_item_upsert",
  "menu.category.upsert": "audit.action.menu_category_upsert",
  "menu.modifier_group.upsert": "audit.action.menu_group_upsert",
  "menu.availability": "audit.action.menu_availability",
  "menu.delete": "audit.action.menu_delete",
  "menu.sort": "audit.action.menu_sort",
  "receipt.print": "audit.action.receipt_print",
  "table_session.staff_meal_set": "audit.action.staff_meal_set",
  "table_session.staff_meal_clear": "audit.action.staff_meal_clear",
  "staff.login": "audit.action.staff_login",
  "staff.session_revoke": "audit.action.staff_session_revoke",
  "staff.create": "audit.action.staff_create",
  "staff.update": "audit.action.staff_update",
  "staff.pin_reset": "audit.action.staff_pin_reset",
  "staff.deactivate": "audit.action.staff_deactivate",
  "staff.activate": "audit.action.staff_activate",
  "shift.open": "audit.action.shift_open",
  "shift.close": "audit.action.shift_close",
  "settings.tax_update": "audit.action.settings_tax",
  "settings.business_update": "audit.action.settings_business",
  "settings.station_upsert": "audit.action.settings_station_upsert",
  "settings.station_delete": "audit.action.settings_station_delete",
  "settings.table_upsert": "audit.action.settings_table_upsert",
  "settings.table_rotate_qr": "audit.action.settings_table_rotate_qr",
  "settings.table_delete": "audit.action.settings_table_delete",
};

/**
 * action ที่ควรถูกมองก่อนเสมอเวลาสืบสวน — หน้าจอเน้นแถวพวกนี้ให้เห็นชัด
 *
 * ทั้งสามอย่างมีจุดร่วมคือ **ทำให้ร้านได้เงินน้อยลง** ซึ่งเป็นทิศทางเดียวที่
 * การโกงหน้าร้านเป็นไปได้ (ไม่มีใครโกงด้วยการเก็บเงินลูกค้าเพิ่ม)
 */
export const AUDIT_SENSITIVE_ACTIONS: readonly string[] = [
  "order_item.cancel",
  "table_session.staff_meal_set",
  "table_session.abandon",
  /**
   * เพิ่มในบทที่ 13b — ไม่ได้ทำให้ร้านเสียเงินโดยตรงเหมือนสามอันบน แต่เป็น
   * "การได้มาซึ่งสิทธิ์" ซึ่งเป็นขั้นก่อนหน้าของการโกงทุกแบบ: ตั้งพนักงานใหม่
   * เป็นผู้จัดการ หรือรีเซ็ต PIN ของคนอื่นแล้วไปกดในนามเขา
   */
  "staff.create",
  "staff.update",
  "staff.pin_reset",
  /**
   * เพิ่มในก้อน Settings — ลดเซอร์วิสชาร์จเป็น 0 ตอนดึก เก็บเงินลูกค้าเท่าเดิม
   * แล้วตั้งกลับตอนเช้า คือการโกงที่เนียนที่สุดเท่าที่ระบบนี้เปิดช่องให้ทำได้
   * (ตระกูลเดียวกับการแก้ราคาเมนูชั่วคราวในโมดูล 04)
   */
  "settings.tax_update",
];

/**
 * คีย์ป้ายของ action — **คืน null เมื่อไม่รู้จัก**
 *
 * ผู้เรียกต้องแสดงชื่อ action ดิบแทน ห้ามซ่อนแถว (ดูคอมเมนต์ที่ AUDIT_ACTION_KEYS)
 */
export function auditActionKey(action: string): MessageKey | null {
  return ownKey(AUDIT_ACTION_KEYS, action);
}

/** คีย์ป้ายของฟิลด์ใน metadata — คืน null เมื่อไม่รู้จัก (แสดงชื่อคีย์ดิบแทน) */
export function auditFieldKey(field: string): MessageKey | null {
  return ownKey(METADATA_KEYS, field);
}

/**
 * ค้นเฉพาะคีย์ที่ประกาศเองในตาราง — `map["constructor"]` แบบตรง ๆ ได้ฟังก์ชัน
 * ของ Object.prototype กลับมาแทน null แล้วแถวนั้นจะขึ้นป้ายว่างบนจอ ซึ่งผิดกฎ
 * "ไม่รู้จัก = แสดงชื่อดิบ" (metadata เป็น JSON อิสระ ชื่อคีย์จึงเป็นอะไรก็ได้)
 */
function ownKey(map: Record<string, MessageKey>, key: string): MessageKey | null {
  return Object.hasOwn(map, key) ? map[key] : null;
}

/**
 * ป้ายหนึ่งบรรทัดของ metadata
 *
 * `labelKey` เป็น null ได้ = ยังไม่มีคำแปลของคีย์นี้ ผู้เรียก **ต้อง** แสดง
 * `rawKey` แทน ห้ามข้ามแถวทิ้ง (กติกาบทที่ 13a)
 *
 * `valueKey` มีค่าเฉพาะค่าที่ต้องแปล (ตอนนี้คือ true/false → "ใช่/ไม่")
 * ผู้เรียกแสดง `t(valueKey)` ถ้ามี ไม่งั้นแสดง `value` ตรง ๆ — ไฟล์นี้จึง
 * ไม่ต้องมีคำของภาษาไหนเลย
 */
export type AuditField = {
  labelKey: MessageKey | null;
  rawKey: string;
  value: string;
  valueKey: MessageKey | null;
};

/**
 * แปลง `metadata` เป็นรายการ ป้าย–ค่า ที่คนอ่านรู้เรื่อง
 *
 * รับ `formatAmount` เข้ามาแทนที่จะ import `formatMoney` ตรง ๆ เพราะสกุลเงิน
 * อยู่ใน metadata เอง (บิลเก่าอาจคนละสกุลกับสาขาตอนนี้ถ้าเคยเปลี่ยน) —
 * ผู้เรียกเป็นคนตัดสินว่าจะใช้สกุลไหน ไฟล์นี้แค่จัดรูป
 */
export function auditMetadataFields(
  metadata: unknown,
  formatAmount: (amount: number, currency: string | null) => string,
): AuditField[] {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata === null || metadata === undefined
      ? []
      : [{
          labelKey: "audit.field.raw",
          rawKey: "raw",
          value: JSON.stringify(metadata),
          valueKey: null,
        }];
  }

  const record = metadata as Record<string, unknown>;
  const currency = typeof record.currency === "string" ? record.currency : null;

  const out: AuditField[] = [];
  for (const [key, raw] of Object.entries(record)) {
    if (raw === null || raw === undefined || raw === "") continue;

    const labelKey = auditFieldKey(key);

    /**
     * คีย์ที่ยังไม่มีป้าย **ยังต้องแสดง** โดยใช้ชื่อคีย์ดิบเป็นป้าย
     * — บทถัดไปที่เพิ่ม metadata ใหม่จะได้เห็นค่าทันทีโดยไม่ต้องมาแก้ไฟล์นี้ก่อน
     */
    out.push({
      labelKey,
      rawKey: key,
      value: MONEY_KEYS.has(key) && typeof raw === "number"
        ? formatAmount(raw, currency)
        : formatValue(raw),
      valueKey: typeof raw === "boolean" ? (raw ? "common.yes" : "common.no") : null,
    });
  }

  return out;
}

/** คีย์ที่เป็นจำนวนเงิน — ต้องผ่าน formatMoney ไม่ใช่โชว์เลขดิบ */
const MONEY_KEYS = new Set([
  "subtotal",
  "discountAmount",
  "serviceChargeAmount",
  "vatAmount",
  "netAmount",
  "grandTotal",
  "receivedAmount",
  "changeAmount",
  "lineTotal",
  "priceBefore",
  "priceAfter",
  "basePriceBefore",
  "basePriceAfter",
]);

const METADATA_KEYS: Record<string, MessageKey> = {
  method: "audit.field.method",
  currency: "audit.field.currency",
  subtotal: "audit.field.subtotal",
  discountAmount: "audit.field.discountAmount",
  discountBp: "audit.field.discountBp",
  serviceChargeAmount: "audit.field.serviceChargeAmount",
  vatAmount: "audit.field.vatAmount",
  grandTotal: "audit.field.grandTotal",
  receivedAmount: "audit.field.receivedAmount",
  changeAmount: "audit.field.changeAmount",
  orderCount: "audit.field.orderCount",
  tableId: "audit.field.tableId",
  tableSessionId: "audit.field.tableSessionId",
  tableName: "audit.field.tableName",
  queueNumber: "audit.field.queueNumber",
  reason: "audit.field.reason",
  staffCustomerId: "audit.field.staffCustomerId",
  staffCustomerName: "audit.field.staffCustomerName",
  previousCustomerId: "audit.field.previousCustomerId",
  number: "audit.field.number",
  printCount: "audit.field.printCount",
  isCopy: "audit.field.isCopy",
  demoMode: "audit.field.demoMode",
  staffCode: "audit.field.staffCode",
  name: "audit.field.name",
  nameBefore: "audit.field.nameBefore",
  nameAfter: "audit.field.nameAfter",
  priceBefore: "audit.field.priceBefore",
  priceAfter: "audit.field.priceAfter",
  basePriceBefore: "audit.field.basePriceBefore",
  basePriceAfter: "audit.field.basePriceAfter",
  isAvailable: "audit.field.isAvailable",
  quantity: "audit.field.quantity",
  lineTotal: "audit.field.lineTotal",
  // หน้าตั้งค่าเขียน metadata เป็น { before, after } ทั้งก้อน (lib/server/settings.ts)
  before: "audit.field.before",
  after: "audit.field.after",
};

/**
 * ค่าดิบเป็นข้อความ — boolean คืน "true"/"false" เป็นแค่ fallback
 * หน้าจอแสดงคำแปลจาก `valueKey` แทนเสมอ (ดู AuditField)
 */
function formatValue(raw: unknown): string {
  if (typeof raw === "boolean") return String(raw);
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string") return raw;
  return JSON.stringify(raw);
}
