import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import type { MessageKey } from "@/lib/i18n/vi";

/**
 * คีย์ป้ายของวิธีชำระเงิน (บทที่ 11) — ตัวข้อความอยู่ในพจนานุกรม
 *
 * แยกไฟล์ด้วยเหตุผลเดียวกับ lib/order-status.ts: หน้าจอทุกจอ (หน้าคิดเงิน,
 * ใบเสร็จบทที่ 12, รายงานปิดกะบทที่ 15) ต้องเรียกคำเดียวกัน ห้ามพิมพ์ซ้ำเอง
 * ไม่งั้นวันที่ร้านขอเปลี่ยนคำว่า "QR" เป็นชื่อบริการจริง จะต้องไล่แก้ทีละหน้า
 *
 * ชนิดที่คืนเป็น MessageKey — เพิ่มวิธีจ่ายใน schema แล้วลืมเพิ่มคีย์
 * `paymentMethod.<ค่าใหม่>` ในพจนานุกรม tsc จะฟ้องเอง
 */
export function paymentMethodKey(method: PaymentMethod): MessageKey {
  return `paymentMethod.${method}`;
}
