"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/lib/form-state";
import { canAccessScreen } from "@/lib/rbac";
import { advanceKitchenItem, advanceKitchenTicket, serveOrderItem } from "@/lib/server/kds";
import { getCurrentStaff, loginStaff, logoutStaff } from "@/lib/server/staff-session";

/**
 * Server Action ของจอครัว (บทที่ 8)
 *
 * ทุก action เรียก requireKdsStaff() เป็นบรรทัดแรกเสมอ เพราะ action ถูกยิงตรง
 * ด้วย POST ได้ การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์ (กฎเดียวกับ (pos)/pos/actions.ts)
 *
 * ตัวตรวจสิทธิ์ "ละเอียดกว่าหน้าจอ" อยู่ลึกลงไปอีกชั้นที่ lib/server/kds.ts —
 * เข้าจอครัวได้ (canAccessScreen) ไม่ได้แปลว่ากดปุ่มของครัวได้ (canCookOrderItem)
 * พนักงานเสิร์ฟเข้ามาดูว่าของโต๊ะไหนพร้อมยกได้ แต่กดแทนครัวว่า "ทำเสร็จแล้ว" ไม่ได้
 */

const NOT_SIGNED_IN: FormState = {
  status: "error",
  message: "Session expired — please enter your PIN again",
};

async function requireKdsStaff() {
  const staff = await getCurrentStaff("kds");
  return staff && canAccessScreen(staff.role, "kds") ? staff : null;
}

/**
 * ล็อกอินเข้าจอครัว
 *
 * แยกจาก loginAction ของ POS เพราะตรวจคนละหน้าจอและเด้งไปคนละที่ —
 * พนักงานครัวที่ใส่ PIN ถูกต้องแต่ไปโผล่หน้า POS คือ bug ไม่ใช่ความสะดวก
 */
export async function kdsLoginAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await loginStaff(
    String(formData.get("staffCode") ?? ""),
    String(formData.get("pin") ?? ""),
    "kds",
  );

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  if (!canAccessScreen(result.staff.role, "kds")) {
    // ต้อง logout ทิ้งด้วย ไม่ใช่แค่คืน error — ไม่งั้น cookie ที่เพิ่งออกให้จะค้าง
    // อยู่แล้วคนคนนั้นเดินไปเปิด /pos ต่อได้เลยโดยไม่ต้องใส่ PIN ใหม่
    await logoutStaff("kds");
    return { status: "error", message: "Your role can't access the kitchen display" };
  }

  redirect("/kds");
}

export async function kdsLogoutAction(): Promise<void> {
  await logoutStaff("kds");
  redirect("/kds/login");
}

/** ครัวกดปุ่มถัดไปของรายการเดียว (รับออร์เดอร์ / ทำเสร็จแล้ว) */
export async function advanceItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireKdsStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await advanceKitchenItem(staff, String(formData.get("orderItemId") ?? ""));

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  /**
   * refresh() ที่นี่ทั้งที่มี SSE อยู่แล้ว ไม่ใช่ของซ้ำซ้อน
   *
   * SSE ทำให้ "จออื่น" เห็นการเปลี่ยนแปลง ส่วน refresh() ทำให้ "จอที่กดปุ่ม"
   * เห็นผลทันทีโดยไม่ต้องรอ event วิ่งอ้อมกลับมาหาตัวเอง — คนที่กดปุ่มเองเป็น
   * คนที่ทนการหน่วงได้น้อยที่สุด (และถ้าสาย SSE หลุดอยู่พอดี ปุ่มก็ยังต้องทำงาน)
   */
  refresh();

  return result.changed > 0
    ? { status: "success", message: "Updated" }
    : // changed = 0 แปลว่าอีกจอกดไปก่อนแล้ว ซึ่งคือผลลัพธ์ที่ต้องการอยู่ดี
      { status: "success", message: "This item was already updated" };
}

/** บั๊มทั้งใบ — ดันทุกรายการของสถานีนี้ในบิลเดียวกันไปขั้นถัดไปพร้อมกัน */
export async function advanceTicketAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireKdsStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const stationId = String(formData.get("stationId") ?? "");

  const result = await advanceKitchenTicket(
    staff,
    String(formData.get("orderId") ?? ""),
    // ค่าว่าง = กำลังดูแท็บ "ทุกสถานี" ให้บั๊มทุกสถานีในบิลนั้น
    stationId.length > 0 ? stationId : null,
  );

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  refresh();

  return { status: "success", message: `Updated ${result.changed} item(s)` };
}

/** พนักงานเสิร์ฟกด "ยกไปเสิร์ฟแล้ว" (READY → SERVED) */
export async function serveItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireKdsStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await serveOrderItem(staff, String(formData.get("orderItemId") ?? ""));

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  refresh();

  return { status: "success", message: "Served" };
}
