"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/lib/form-state";
import { canAccessScreen } from "@/lib/rbac";
import { addToCart, placeOrder, setCartLineQuantity } from "@/lib/server/cart";
import {
  cancelOrderItemByStaff,
  closeTableSession,
  getPosTable,
  openTableByStaff,
} from "@/lib/server/pos";
import { getCurrentStaff, loginStaff, logoutStaff } from "@/lib/server/staff-session";

/**
 * Server Action ของเครื่องพนักงาน (บทที่ 9 + ล็อกอิน PIN จากบทที่ 13)
 *
 * ทุก action ที่ไม่ใช่การล็อกอิน เรียก requirePosStaff() เป็นบรรทัดแรกเสมอ
 * เพราะ action ถูกยิงตรงด้วย POST ได้ การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์
 */

const NOT_SIGNED_IN: FormState = {
  status: "error",
  message: "เซสชันหมดอายุ กรุณาใส่ PIN ใหม่",
};

async function requirePosStaff() {
  const staff = await getCurrentStaff();
  return staff && canAccessScreen(staff.role, "pos") ? staff : null;
}

/** หา "รอบโต๊ะที่เปิดอยู่" ของโต๊ะนั้นในสาขาของพนักงานคนนี้ */
async function resolveOpenSession(branchId: string, tableId: string) {
  const detail = await getPosTable(branchId, tableId);
  return detail?.session ?? null;
}

export async function loginAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const result = await loginStaff(
    String(formData.get("staffCode") ?? ""),
    String(formData.get("pin") ?? ""),
  );

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  if (!canAccessScreen(result.staff.role, "pos")) {
    await logoutStaff();
    return { status: "error", message: "ตำแหน่งของคุณไม่มีสิทธิ์เข้าหน้า POS" };
  }

  redirect("/pos");
}

export async function logoutAction(): Promise<void> {
  await logoutStaff();
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
    return { status: "error", message: result.error };
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
    return { status: "error", message: result.error };
  }

  redirect("/pos");
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
    return { status: "error", message: result.error };
  }

  refresh();

  return { status: "success", message: "ยกเลิกรายการแล้ว" };
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
  const session = await resolveOpenSession(staff.branchId, tableId);

  if (!session) {
    return { status: "error", message: "โต๊ะนี้ยังไม่ได้เปิด กรุณากดเปิดโต๊ะก่อน" };
  }

  const result = await addToCart({
    tableSessionId: session.id,
    branchId: staff.branchId,
    tableId,
    timezone: staff.branch.timezone,
    menuItemId: String(formData.get("menuItemId") ?? ""),
    quantity: Number.parseInt(String(formData.get("quantity") ?? "1"), 10),
    modifierIds: formData.getAll("modifierId").map(String),
    note: formData.get("note") ? String(formData.get("note")) : null,
    channel: "POS",
  });

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  // กลับไปจอสั่งอาหารของโต๊ะต่อ เพราะพนักงานมักรับออร์เดอร์รวดเดียวหลายอย่าง
  // — จอนั้นมีทั้งเมนูและตะกร้าอยู่แล้ว จึงเห็นของที่เพิ่งใส่โผล่ทางขวาทันที
  redirect(`/pos/table/${tableId}`);
}

export async function posSetLineQuantityAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requirePosStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const session = await resolveOpenSession(staff.branchId, String(formData.get("tableId") ?? ""));

  if (!session) {
    return { status: "error", message: "โต๊ะนี้ยังไม่ได้เปิด" };
  }

  const result = await setCartLineQuantity(
    session.id,
    String(formData.get("orderItemId") ?? ""),
    Number.parseInt(String(formData.get("quantity") ?? "0"), 10),
  );

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  refresh();

  return { status: "success", message: "อัปเดตตะกร้าแล้ว" };
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

  const tableId = String(formData.get("tableId") ?? "");
  const session = await resolveOpenSession(staff.branchId, tableId);

  if (!session) {
    return { status: "error", message: "โต๊ะนี้ยังไม่ได้เปิด" };
  }

  const result = await placeOrder(session.id, { placedByStaffId: staff.id });

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  redirect(`/pos/table/${tableId}`);
}
