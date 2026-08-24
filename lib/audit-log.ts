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

/** ป้ายไทยของ action ที่ระบบเขียนอยู่ตอนนี้ */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "payment.take": "รับเงิน / ปิดบิล",
  "order_item.cancel": "ยกเลิกรายการอาหาร",
  "table_session.abandon": "ปิดรอบโต๊ะทิ้ง",
  "staff.login_failed": "ใส่ PIN ผิด",
  "menu.item.upsert": "แก้ไขเมนู",
  "menu.category.upsert": "แก้ไขหมวดเมนู",
  "menu.modifier_group.upsert": "แก้ไขกลุ่มตัวเลือก",
  "menu.availability": "เปิด/ปิดขาย",
  "menu.delete": "ลบรายการเมนู",
  "menu.sort": "เรียงลำดับเมนู",
  "receipt.print": "พิมพ์ใบเสร็จ",
  "table_session.staff_meal_set": "ติดธงส่วนลดพนักงาน",
  "table_session.staff_meal_clear": "ปลดธงส่วนลดพนักงาน",
  "staff.login": "เข้าใช้งาน",
  "staff.session_revoke": "เตะออกจากเครื่อง",
  "staff.create": "เพิ่มพนักงาน",
  "staff.update": "แก้ไขพนักงาน",
  "staff.pin_reset": "รีเซ็ต PIN",
  "staff.deactivate": "ปิดใช้งานพนักงาน",
  "staff.activate": "เปิดใช้งานพนักงาน",
  "settings.tax_update": "แก้อัตราภาษี/ค่าบริการ",
  "settings.business_update": "แก้ข้อมูลร้าน",
  "settings.station_upsert": "แก้สถานีครัว",
  "settings.station_delete": "ลบสถานีครัว",
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

/** ป้ายของ action ที่ยังไม่มีในตาราง — คืนชื่อดิบ ไม่ใช่ "ไม่ทราบ" */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

export type AuditField = { label: string; value: string };

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
      : [{ label: "ข้อมูล", value: JSON.stringify(metadata) }];
  }

  const record = metadata as Record<string, unknown>;
  const currency = typeof record.currency === "string" ? record.currency : null;

  const out: AuditField[] = [];
  for (const [key, raw] of Object.entries(record)) {
    if (raw === null || raw === undefined || raw === "") continue;

    const label = METADATA_LABEL[key];

    /**
     * คีย์ที่ยังไม่มีป้าย **ยังต้องแสดง** โดยใช้ชื่อคีย์ดิบเป็นป้าย
     * — บทถัดไปที่เพิ่ม metadata ใหม่จะได้เห็นค่าทันทีโดยไม่ต้องมาแก้ไฟล์นี้ก่อน
     */
    out.push({
      label: label ?? key,
      value: MONEY_KEYS.has(key) && typeof raw === "number"
        ? formatAmount(raw, currency)
        : formatValue(raw),
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

const METADATA_LABEL: Record<string, string> = {
  method: "วิธีจ่าย",
  currency: "สกุลเงิน",
  subtotal: "ค่าอาหาร",
  discountAmount: "ส่วนลด",
  discountBp: "อัตราส่วนลด (bp)",
  serviceChargeAmount: "เซอร์วิสชาร์จ",
  vatAmount: "VAT",
  grandTotal: "รวมทั้งสิ้น",
  receivedAmount: "รับเงิน",
  changeAmount: "เงินทอน",
  orderCount: "จำนวนบิล",
  /**
   * "จุดขาย" ไม่ใช่ "โต๊ะ" — แถวใน RestaurantTable เป็นได้ทั้งโต๊ะนั่ง
   * เคาน์เตอร์ซื้อกลับ และช่องไรเดอร์ (ดู lib/sale-point.ts) ป้ายที่เขียนว่า
   * "โต๊ะ" ทำให้คนที่กำลังสืบสวนอ่านบิลซื้อกลับผิดประเภทไปเลย
   *
   * ยังเป็น id ดิบอยู่โดยตั้งใจ: metadata ของ AuditLog เก็บค่า ณ ตอนนั้นไว้แล้ว
   * การไป join ชื่อสดตอนแสดงผลจะทำให้ log เปลี่ยนไปตามการแก้ชื่อภายหลัง
   * ซึ่งขัดกับจุดประสงค์ทั้งหมดของ audit log
   */
  tableId: "จุดขาย (id)",
  tableSessionId: "รอบขาย (id)",
  /** ชื่อจุดขาย ณ เวลานั้น — action ที่เขียนค่านี้ลง metadata จะอ่านง่ายกว่า id มาก */
  tableName: "จุดขาย",
  queueNumber: "เลขคิว",
  reason: "เหตุผล",
  staffCustomerId: "พนักงานที่กิน (id)",
  staffCustomerName: "พนักงานที่กิน",
  previousCustomerId: "คนกินเดิม (id)",
  number: "เลขที่เอกสาร",
  printCount: "พิมพ์ครั้งที่",
  isCopy: "เป็นสำเนา",
  demoMode: "โหมดสาธิต",
  staffCode: "รหัสพนักงาน",
  name: "ชื่อ",
  nameBefore: "ชื่อเดิม",
  nameAfter: "ชื่อใหม่",
  priceBefore: "ราคาเดิม",
  priceAfter: "ราคาใหม่",
  basePriceBefore: "ราคาเดิม",
  basePriceAfter: "ราคาใหม่",
  isAvailable: "เปิดขาย",
  quantity: "จำนวน",
  lineTotal: "ยอดรายการ",
};

function formatValue(raw: unknown): string {
  if (typeof raw === "boolean") return raw ? "ใช่" : "ไม่";
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string") return raw;
  return JSON.stringify(raw);
}
