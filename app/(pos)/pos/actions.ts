"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { formError, type FormState } from "@/lib/form-state";
import { canAccessScreen } from "@/lib/rbac";
import { salePointBasePath, showsInTableMap } from "@/lib/sale-point";
import type { SalePointKind } from "@/lib/generated/prisma/enums";
import { addToCart, placeOrder, setCartLineQuantity } from "@/lib/server/cart";
import { serveOrderItem } from "@/lib/server/kds";
import { takePayment } from "@/lib/server/payment";
import {
  cancelOrderItemByStaff,
  closeTableSession,
  getPosSession,
  getPosTable,
  openSalePointSession,
  openTableByStaff,
  setSessionCustomerName,
} from "@/lib/server/pos";
import { recordReceiptPrint } from "@/lib/server/receipt";
import { clearStaffMeal, setStaffMeal } from "@/lib/server/staff-meal";
import { mergeTableSessions, moveTableSession } from "@/lib/server/table-move";
import { getCurrentStaff, loginStaff, logoutStaff } from "@/lib/server/staff-session";
import type { MessageParams } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

/**
 * Server Action ของเครื่องพนักงาน (บทที่ 9 + ล็อกอิน PIN จากบทที่ 13)
 *
 * ทุก action ที่ไม่ใช่การล็อกอิน เรียก requirePosStaff() เป็นบรรทัดแรกเสมอ
 * เพราะ action ถูกยิงตรงด้วย POST ได้ การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์
 */

const NOT_SIGNED_IN: FormState = {
  status: "error",
  messageKey: "error.session_expired",
};

async function requirePosStaff() {
  const staff = await getCurrentStaff("pos");
  return staff && canAccessScreen(staff.role, "pos") ? staff : null;
}

/**
 * `sessionId` ที่ฟอร์มแนบมา — ว่างเปล่าแปลว่า "ไม่ได้ระบุ" ไม่ใช่ "ระบุเป็นค่าว่าง"
 * (ฟอร์มของโต๊ะนั่งไม่มีช่องนี้เลย จึงต้องได้ undefined ไม่ใช่สตริงว่าง)
 */
function sessionIdOf(formData: FormData): string | undefined {
  const value = String(formData.get("sessionId") ?? "").trim();
  return value.length > 0 ? value : undefined;
}

/**
 * หารอบขายที่เปิดอยู่ ซึ่งเป็นเป้าหมายของ action นี้
 *
 * ── ทำไมมีสองทาง ────────────────────────────────────────────────────────
 * โต๊ะนั่งมีรอบเปิดได้ทีละรอบ ฟอร์มจึงส่งมาแค่ `tableId` ได้ตามเดิม
 * (หน้าจอของบทที่ 9 ไม่ต้องแก้อะไรเลย)
 *
 * แต่เคาน์เตอร์ซื้อกลับมีบิลเปิดพร้อมกันได้หลายใบ **ทุก action ที่แก้ของในบิล
 * จึงต้องรู้ว่าใบไหน** ไม่ใช่แค่ตอนรับเงิน — ถ้าเดาเอา พนักงานจะกดเพิ่มของ
 * ให้คิว 12 แล้วของไปโผล่ในบิลของคิว 14 ซึ่งอ่านจากหน้าจอไม่ออกเลยว่าเกิดอะไรขึ้น
 *
 * `sessionId` ที่ส่งมาจากฟอร์ม **เชื่อไม่ได้ทันที** — ต้องตรวจว่าเป็นรอบที่เปิดอยู่
 * ในสาขาของพนักงานคนนี้จริง (`getPosSession` กรอง branchId ให้แล้ว)
 */
async function resolveOpenTarget(branchId: string, tableId: string, sessionId?: string) {
  const detail = sessionId
    ? await getPosSession(branchId, sessionId)
    : await getPosTable(branchId, tableId);

  if (!detail?.session) {
    return null;
  }

  /**
   * จุดขายที่มีบิลเปิดหลายใบแต่ฟอร์มไม่ได้บอกว่าใบไหน = ไม่เดา
   * (กติกาเดียวกับ `takePayment()` — ห้ามมีสองมาตรฐานในเรื่องเดียวกัน)
   */
  if (!sessionId && !showsInTableMap(detail.table.kind) && detail.openSessionCount > 1) {
    return null;
  }

  return { session: detail.session, table: detail.table };
}

/**
 * เส้นทางของจอที่ต้องกลับไปหลัง action เสร็จ
 *
 * คำนวณจาก `kind` ของจุดขาย **ไม่ใช่รับ base มาจากฟอร์ม** เพราะ base ที่ฟอร์ม
 * ส่งมาผิดได้ (คัดลอกฟอร์มไปวางแล้วลืมแก้) แล้วพนักงานจะถูกพากลับไปผิดบิล
 * ซึ่งเป็นบั๊กที่ดูเหมือน "จอค้าง" มากกว่าดูเหมือนบั๊กของลิงก์
 */
function salePointBase(target: { session: { id: string }; table: { id: string; kind: SalePointKind } }) {
  return salePointBasePath(target.table, target.session);
}

export async function loginAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const result = await loginStaff(
    String(formData.get("staffCode") ?? ""),
    String(formData.get("pin") ?? ""),
    "pos",
  );

  if (!result.ok) {
    return formError(result);
  }

  if (!canAccessScreen(result.staff.role, "pos")) {
    await logoutStaff("pos");
    return { status: "error", messageKey: "error.no_access_pos" };
  }

  redirect("/pos");
}

export async function logoutAction(): Promise<void> {
  await logoutStaff("pos");
  redirect("/pos/login");
}

/** เปิดโต๊ะให้ลูกค้า (พนักงานกดแทนการสแกน QR) */
export async function openTableAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const tableId = String(formData.get("tableId") ?? "");
  const result = await openTableByStaff(
    staff,
    tableId,
    Number.parseInt(String(formData.get("pax") ?? "1"), 10),
  );

  if (!result.ok) {
    return formError(result);
  }

  redirect(`/pos/table/${tableId}`);
}

/** ปิดรอบโต๊ะที่ยังไม่มีบิลเข้าครัว (เปิดผิดใบ / ลูกค้าลุกไปก่อนสั่ง) */
export async function closeTableAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await closeTableSession(
    staff,
    String(formData.get("sessionId") ?? ""),
    String(formData.get("reason") ?? ""),
  );

  if (!result.ok) {
    return formError(result);
  }

  redirect("/pos");
}

/**
 * พนักงานกด "เสิร์ฟแล้ว" จากหน้าบิลของโต๊ะ (READY → SERVED)
 *
 * มีปุ่มนี้ทั้งที่จอครัวก็มี เพราะจอครัวแสดงเฉพาะของที่ต้องผ่านครัว —
 * น้ำเปล่าที่หยิบจากตู้เย็นไม่เคยขึ้นจอครัวเลย ถ้าไม่มีปุ่มตรงนี้จะไม่มีใคร
 * ปิดรายการพวกนั้นได้ แล้วบิลจะค้างไม่ถึง SERVED จนคิดเงินไม่ได้ในบทที่ 10
 *
 * ใช้ requirePosStaff() ไม่ใช่ requireKdsStaff() เพราะแคชเชียร์เข้าจอครัวไม่ได้
 * แต่กดเสิร์ฟได้ (ดู canServeOrderItem ใน lib/rbac.ts) — ตัวตรวจสิทธิ์จริง
 * อยู่ใน serveOrderItem() อีกชั้น
 */
export async function posServeItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await serveOrderItem(staff, String(formData.get("orderItemId") ?? ""));

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return { status: "success", messageKey: "msg.served" };
}

/**
 * รับเงินและปิดบิลของโต๊ะ (บทที่ 11 — โหมดสาธิต)
 *
 * ส่งจากหน้าจอมาแค่ **"วิธีจ่าย" กับ "รับเงินสดมาเท่าไหร่"** เท่านั้น
 * ยอดที่ต้องจ่ายคิดใหม่ฝั่ง server ทุกครั้งใน takePayment() —
 * ค่า `expectedTotal` ที่แนบมาด้วยไม่ได้ถูกใช้เป็นยอด แต่ใช้ตรวจว่าบิลเปลี่ยนไป
 * ระหว่างที่แคชเชียร์กำลังกดหรือเปล่า (ดูเหตุผลใน lib/server/payment.ts)
 *
 * สำเร็จแล้ว redirect ไปหน้าเดิมพร้อม `?paid=<id>` ซึ่งจะกลายเป็นหน้าสรุปการรับเงิน
 * — ต้อง redirect ไม่ใช่ refresh() เพราะพอปิดบิลแล้วรอบโต๊ะถูกปิดไปด้วย
 * หน้าคิดเงินเดิมจะไม่มีอะไรให้แสดงอีกเลย
 */
export async function takePaymentAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const tableId = String(formData.get("tableId") ?? "");
  const method = String(formData.get("method") ?? "");

  if (method !== "CASH" && method !== "QR") {
    return { status: "error", messageKey: "error.choose_payment_method" };
  }

  const sessionId = sessionIdOf(formData);

  /**
   * ต้องหา base **ก่อน** รับเงิน เพราะพอปิดบิลแล้วรอบขายถูกปิดไปด้วย
   * `getPosSession()` (ซึ่งกรองเฉพาะรอบที่เปิดอยู่) จะหาไม่เจออีก
   * — ถ้าไปหาทีหลังจะได้ null แล้ว redirect ไปผิดหน้า
   *
   * หาไม่เจอตั้งแต่แรก = อาจเป็นการกดซ้ำของบิลที่ปิดไปแล้ว ซึ่ง takePayment()
   * จัดการเองได้ (พากลับไปใบเดิม) จึงไม่ error ตรงนี้ แค่ตกกลับไปทางโต๊ะ
   */
  const target = await resolveOpenTarget(staff.branchId, tableId, sessionId);
  const base = target ? salePointBase(target) : `/pos/table/${tableId}`;

  const result = await takePayment(staff, tableId, {
    method,
    // เคาน์เตอร์ที่มีหลายบิลเปิดอยู่ต้องบอกว่าใบไหน ไม่งั้น takePayment() ปฏิเสธ
    // (ดูเหตุผลใน lib/server/payment.ts — เลือก "ไม่เดา" แทน "หยิบล่าสุด")
    sessionId,
    receivedAmount: parseMinorAmount(formData.get("receivedAmount")),
    expectedTotal: parseMinorAmount(formData.get("expectedTotal")),
  });

  if (!result.ok) {
    return formError(result);
  }

  redirect(`${base}/bill?paid=${result.paymentId}`);
}

/**
 * อ่านจำนวนเงินจากฟอร์มเป็น "จำนวนเต็มหน่วยย่อย" — คืน null เมื่อไม่ได้กรอกมา
 *
 * ฟอร์มส่งมาเป็นหน่วยย่อยอยู่แล้ว (หน้าจอเป็นคนแปลงจากที่คนกรอก) ที่นี่จึงแค่
 * ตรวจว่าเป็นจำนวนเต็มจริง — **ห้ามมีการหาร 100 ที่นี่** เพราะสาขา LAK/VND
 * ไม่มีหน่วยย่อย เลขที่กรอกคือจำนวนเต็มของสกุลนั้นตรง ๆ (ดู lib/money.ts)
 */
function parseMinorAmount(value: FormDataEntryValue | null): number | null {
  if (value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);

  return Number.isFinite(parsed) ? parsed : null;
}

/** ยกเลิกรายการอาหารพร้อมเหตุผล (บันทึก AuditLog ทุกครั้ง) */
export async function cancelItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await cancelOrderItemByStaff(
    staff,
    String(formData.get("orderItemId") ?? ""),
    String(formData.get("reason") ?? ""),
  );

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return { status: "success", messageKey: "msg.item_cancelled" };
}

/**
 * พนักงานสั่งแทนลูกค้า — ลงในตะกร้า "ใบเดียวกัน" กับที่ลูกค้าสั่งเองจากมือถือ
 * เพราะโต๊ะหนึ่งโต๊ะต้องได้บิลใบเดียว (ดู lib/server/cart.ts)
 */
export async function posAddToCartAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const tableId = String(formData.get("tableId") ?? "");
  const target = await resolveOpenTarget(staff.branchId, tableId, sessionIdOf(formData));

  if (!target) {
    return { status: "error", messageKey: "error.no_open_bill_open_first" };
  }

  const result = await addToCart({
    tableSessionId: target.session.id,
    branchId: staff.branchId,
    tableId: target.table.id,
    timezone: staff.branch.timezone,
    menuItemId: String(formData.get("menuItemId") ?? ""),
    quantity: Number.parseInt(String(formData.get("quantity") ?? "1"), 10),
    modifierIds: formData.getAll("modifierId").map(String),
    note: formData.get("note") ? String(formData.get("note")) : null,
    channel: "POS",
  });

  if (!result.ok) {
    return formError(result);
  }

  // กลับไปจอสั่งอาหารของโต๊ะต่อ เพราะพนักงานมักรับออร์เดอร์รวดเดียวหลายอย่าง
  // — จอนั้นมีทั้งเมนูและตะกร้าอยู่แล้ว จึงเห็นของที่เพิ่งใส่โผล่ทางขวาทันที
  redirect(salePointBase(target));
}

export async function posSetLineQuantityAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const target = await resolveOpenTarget(
    staff.branchId,
    String(formData.get("tableId") ?? ""),
    sessionIdOf(formData),
  );

  if (!target) {
    return { status: "error", messageKey: "error.no_open_bill" };
  }

  const result = await setCartLineQuantity(
    target.session.id,
    String(formData.get("orderItemId") ?? ""),
    Number.parseInt(String(formData.get("quantity") ?? "0"), 10),
  );

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return { status: "success", messageKey: "msg.cart_updated" };
}

/** ส่งตะกร้าของโต๊ะเข้าครัว โดยบันทึกว่าพนักงานคนไหนเป็นคนกด */
export async function posPlaceOrderAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const target = await resolveOpenTarget(
    staff.branchId,
    String(formData.get("tableId") ?? ""),
    sessionIdOf(formData),
  );

  if (!target) {
    return { status: "error", messageKey: "error.no_open_bill" };
  }

  const result = await placeOrder(target.session.id, { placedByStaffId: staff.id });

  if (!result.ok) {
    return formError(result);
  }

  redirect(salePointBase(target));
}

/** เปิดบิลซื้อกลับใบใหม่แล้วพาไปที่จอสั่งอาหารของบิลนั้นทันที */
export async function openSalePointAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await openSalePointSession(staff, String(formData.get("tableId") ?? ""));

  if (!result.ok) {
    return formError(result);
  }

  redirect(`/pos/counter/${result.session.id}`);
}

/**
 * ตั้ง/ล้างชื่อลูกค้าของบิลซื้อกลับ
 *
 * ไม่ redirect เพราะพนักงานยังอยู่กับบิลใบเดิม — แค่ `refresh()` ให้หัวจอกับ
 * แถบคิวอ่านชื่อใหม่ (และ `announce()` ฝั่ง server ทำให้จออื่นที่เปิดค้างขยับตาม)
 */
export async function setCustomerNameAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await setSessionCustomerName(
    staff,
    String(formData.get("sessionId") ?? ""),
    String(formData.get("customerName") ?? ""),
  );

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return {
    status: "success",
    messageKey: result.customerName ? "msg.customer_name_saved" : "msg.customer_name_cleared",
    params: { name: result.customerName ?? "" },
  };
}

/**
 * บันทึกการพิมพ์ใบเสร็จจากจอ POS (บทที่ 12)
 *
 * มีคู่แฝดอยู่ที่ app/(admin)/admin/actions.ts ที่ทำเรื่องเดียวกันเป๊ะ **และนั่นถูกแล้ว**
 * — ต่างกันที่ cookie ที่อ่าน (`pos` กับ `admin`) ซึ่งเป็นคนละ session คนละคนกด
 * และ AuditLog ต้องแยกออกจากกันให้ได้ว่ากดจากจอไหน การรวมเป็น action เดียว
 * แปลว่าต้องมี action ที่ยอมรับ cookie ใบไหนก็ได้ ซึ่งเป็นรูปแบบ auth แบบที่สี่
 * ที่ระบบนี้ตั้งใจไม่มี (ดู archive/report/2026-08-23-plan-chapter-12-receipt.md §2.4)
 *
 * ตรรกะจริงทั้งหมดอยู่ที่ recordReceiptPrint() ที่เดียว ตรงนี้เป็นแค่ด่าน session
 */
export async function posPrintReceiptAction(
  receiptId: string,
): Promise<{ ok: boolean; errorKey?: MessageKey; params?: MessageParams }> {
  const staff = await requirePosStaff();

  if (!staff) {
    return { ok: false, errorKey: "error.session_expired" };
  }

  const result = await recordReceiptPrint(staff, receiptId);

  if (!result.ok) {
    return { ok: false, errorKey: result.errorKey };
  }

  // ป้าย "สำเนา" กับตัวเลข "พิมพ์ครั้งที่ N" บนใบต้องอัปเดตก่อนกล่องพิมพ์เปิด
  refresh();

  return { ok: true };
}

/**
 * ติดธง "บิลนี้พนักงานกิน" เพื่อรับส่วนลดพนักงาน (บทที่ 13)
 *
 * ส่งมาแค่ **โต๊ะกับ id ของคนกิน** — อัตราส่วนลดไม่ได้มาจากหน้าจอเลย
 * มันอยู่ที่ `Branch.staffMealDiscountBp` และถูกอ่านสดตอนคิดบิลทุกครั้ง
 * (ถ้าปล่อยให้หน้าจอส่งเปอร์เซ็นต์มา นั่นคือช่องให้ยิง POST ตรงพร้อมเลข 100)
 */
export async function setStaffMealAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await setStaffMeal(
    staff,
    String(formData.get("tableId") ?? ""),
    String(formData.get("staffCustomerId") ?? ""),
    sessionIdOf(formData),
  );

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return { status: "success", messageKey: "msg.staff_meal_flagged" };
}

/**
 * ย้ายรอบขายทั้งชุดไปโต๊ะว่างอีกใบ
 *
 * ปลายทางของ redirect มาจาก **ผลลัพธ์ของ action** ไม่ใช่ค่าที่ฟอร์มส่งมา —
 * ค่าที่ฟอร์มส่งมาบอกได้แค่ "ตั้งใจจะไปไหน" ส่วน `toTableId` ที่คืนกลับมาคือ
 * โต๊ะที่ย้ายไปจริงหลัง commit (ท่าเดียวกับที่ `salePointBase()` ไม่รับ base จากฟอร์ม)
 *
 * ทั้งย้ายและรวมเป็นเรื่องของโต๊ะนั่งเท่านั้น (`table-move.ts` ปฏิเสธช่องทางอื่น)
 * เส้นทางปลายทางจึงเป็น `/pos/table/<id>` เสมอ ไม่ต้องแยกตาม kind
 */
export async function moveTableAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await moveTableSession(staff, {
    sessionId: String(formData.get("sessionId") ?? ""),
    targetTableId: String(formData.get("targetTableId") ?? ""),
  });

  if (!result.ok) {
    return formError(result);
  }

  // URL เดิมชี้โต๊ะที่ว่างไปแล้ว ถ้าไม่พาไปโต๊ะใหม่พนักงานจะเห็นจอ "เปิดโต๊ะ" ว่าง ๆ
  redirect(`/pos/table/${result.toTableId}`);
}

/** รวมบิลของโต๊ะนี้เข้ากับบิลของโต๊ะอื่นที่มีคนนั่งอยู่ — แยกกลับไม่ได้ */
export async function mergeTableAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await mergeTableSessions(staff, {
    sourceSessionId: String(formData.get("sessionId") ?? ""),
    targetSessionId: String(formData.get("targetSessionId") ?? ""),
  });

  if (!result.ok) {
    return formError(result);
  }

  // รอบของโต๊ะนี้ถูกกลืนไปแล้ว หน้าเดิมจึงไม่มีบิลให้ดูอีก — พาไปบิลที่รวมแล้ว
  redirect(`/pos/table/${result.toTableId}`);
}

/** ปลดธงส่วนลดพนักงานออกจากบิล (บทที่ 13) */
export async function clearStaffMealAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await clearStaffMeal(
    staff,
    String(formData.get("tableId") ?? ""),
    sessionIdOf(formData),
  );

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return { status: "success", messageKey: "msg.staff_meal_cleared" };
}
