/**
 * ข้อความภาษาเวียดนาม — **ต้นฉบับของทั้งระบบ**
 *
 * ไฟล์นี้เป็นแหล่งความจริงเรื่องรายชื่อคีย์: `en.ts` ประกาศตัวเองเป็น
 * `Record<MessageKey, string>` เพราะฉะนั้นคีย์ที่เพิ่มที่นี่แล้วลืมแปล
 * จะทำให้ `tsc` พัง ไม่ใช่หลุดไปโผล่บนจอเป็นคีย์ดิบ — และคีย์ที่เกินมา
 * ใน en.ts ก็ถูกจับด้วย excess property check เหมือนกัน
 *
 * ── กติกาของคีย์ ────────────────────────────────────────────────────────
 *   - แบน ใช้จุดคั่น namespace เช่น "pos.table.open"
 *   - คู่ `.one`/`.other` = คีย์ที่ใช้กับ tCount() (เวียดนามใช้รูปเดียวทั้งคู่
 *     แต่ **ต้องมีครบทั้งสองคีย์** ไม่งั้น tCount() หาคีย์ไม่เจอ)
 *   - `{token}` คือช่องเติมค่า ดู translate()
 *
 * ⚠ ห้ามใส่ชื่อเมนู/หมวด/สถานี/ชื่อพนักงานลงที่นี่ — พวกนั้นเป็น **ข้อมูล**
 * อยู่ในฐานข้อมูล แสดงตามที่เก็บไว้ ไม่ได้แปลตามภาษาที่เลือก
 */
export const vi = {
  // ── ทั่วไป ────────────────────────────────────────────────────────────
  "common.save": "Lưu",
  "common.cancel": "Hủy",
  "common.confirm": "Xác nhận",
  "common.back": "Quay lại",
  "common.close": "Đóng",
  "common.search": "Tìm kiếm",
  "common.language": "Ngôn ngữ",

  // ── สถานะบิล (lib/order-status.ts) ────────────────────────────────────
  "orderStatus.DRAFT": "Giỏ hàng",
  "orderStatus.PLACED": "Đã gửi bếp",
  "orderStatus.IN_PROGRESS": "Đang chế biến",
  "orderStatus.READY": "Sẵn sàng phục vụ",
  "orderStatus.SERVED": "Đã phục vụ",
  "orderStatus.PAID": "Đã thanh toán",
  "orderStatus.CANCELLED": "Đã hủy",

  // ── สถานะรายการในบิล ──────────────────────────────────────────────────
  "orderItemStatus.DRAFT": "Trong giỏ",
  "orderItemStatus.PLACED": "Chờ bếp",
  "orderItemStatus.IN_PROGRESS": "Đang chế biến",
  "orderItemStatus.READY": "Sẵn sàng phục vụ",
  "orderItemStatus.SERVED": "Đã phục vụ",
  "orderItemStatus.CANCELLED": "Đã hủy",

  // ── ปุ่มของจอครัว (KDS) ───────────────────────────────────────────────
  "kitchenAction.PLACED": "Bắt đầu làm",
  "kitchenAction.IN_PROGRESS": "Xong món",

  // ── วิธีชำระเงิน ──────────────────────────────────────────────────────
  "paymentMethod.CASH": "Tiền mặt",
  "paymentMethod.QR": "QR",
  "paymentMethod.CARD": "Thẻ",

  // ── ช่องทางขาย (lib/sale-point.ts) ────────────────────────────────────
  "salePoint.DINE_IN": "Tại chỗ",
  "salePoint.COUNTER": "Mang đi",
  "salePoint.DELIVERY": "Giao hàng",
  "salePoint.tableNamed": "Bàn {name}",
  "salePoint.queued": "{channel} #{queue}",
  "salePoint.channelNamed": "{channel} · {name}",
  "salePoint.fieldTable": "Bàn",
  "salePoint.fieldChannel": "Kênh bán",

  // ── สกุลเงิน (lib/money.ts) ───────────────────────────────────────────
  "currency.THB": "Baht",
  "currency.LAK": "Kip",
  "currency.VND": "Đồng",

  // ── ข้อความผิดพลาดที่ action คืนออกมา ─────────────────────────────────
  "error.session_expired": "Phiên đã hết hạn — vui lòng nhập lại mã PIN",
  "error.not_allowed": "Bạn không có quyền thực hiện thao tác này",
  "error.bad_pin": "Sai mã nhân viên hoặc mã PIN",
  "error.locked_out.one": "Quá nhiều lần thử sai — thử lại sau {count} phút",
  "error.locked_out.other": "Quá nhiều lần thử sai — thử lại sau {count} phút",

  // ── ตัวสลับภาษา ───────────────────────────────────────────────────────
  "locale.vi": "Tiếng Việt",
  "locale.en": "English",
} as const;

export type MessageKey = keyof typeof vi;

export type Dictionary = Record<MessageKey, string>;
