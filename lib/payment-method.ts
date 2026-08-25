import type { PaymentMethod } from "@/lib/generated/prisma/enums";

/**
 * ป้ายภาษาไทยของวิธีชำระเงิน (บทที่ 11)
 *
 * แยกไฟล์ด้วยเหตุผลเดียวกับ lib/order-status.ts: หน้าจอทุกจอ (หน้าคิดเงิน,
 * ใบเสร็จบทที่ 12, รายงานปิดกะบทที่ 15) ต้องเรียกคำเดียวกัน ห้ามพิมพ์ซ้ำเอง
 * ไม่งั้นวันที่ร้านขอเปลี่ยนคำว่า "QR" เป็นชื่อบริการจริง จะต้องไล่แก้ทีละหน้า
 *
 * ประกาศเป็น `Record<PaymentMethod, string>` เพื่อให้ tsc ฟ้องเองถ้าเพิ่มวิธีจ่าย
 * ใน schema แล้วลืมมาเพิ่มป้ายที่นี่
 */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  QR: "QR",
  CARD: "Card",
};
