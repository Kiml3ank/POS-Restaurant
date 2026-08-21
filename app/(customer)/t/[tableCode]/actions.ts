"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { addToCart, placeOrder, setCartLineQuantity } from "@/lib/server/cart";
import { openTableSession, resolveCustomerContext } from "@/lib/server/table-session";

import type { FormState } from "@/lib/form-state";

/**
 * Server Action ของหน้าจอลูกค้า (บทที่ 5 + 7)
 *
 * ข้อควรระวังที่ docs ของ Next.js เตือนไว้: Server Action ถูกยิงตรงด้วย POST
 * ได้โดยไม่ผ่าน UI ของเรา ทุกฟังก์ชันในไฟล์นี้จึงต้องตรวจสิทธิ์เองทุกครั้ง
 * ที่นี่ "สิทธิ์" ของลูกค้าคือ cookie ที่ชี้ไป TableSession ที่ยังเปิดอยู่ของโต๊ะนั้น
 * — ตรวจจาก resolveCustomerContext() ทุกฟังก์ชัน ไม่มีข้อยกเว้น
 */

/** เปิด (หรือเข้าร่วม) รอบโต๊ะ แล้ว set cookie ให้เครื่องลูกค้า */
export async function openTableSessionAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tableCode = String(formData.get("tableCode") ?? "");
  const pax = Number.parseInt(String(formData.get("pax") ?? "1"), 10);

  if (!tableCode) {
    return { status: "error", message: "ไม่พบรหัสโต๊ะ กรุณาสแกน QR ใหม่" };
  }

  if (!Number.isFinite(pax) || pax < 1 || pax > 20) {
    return { status: "error", message: "จำนวนลูกค้าต้องอยู่ระหว่าง 1 ถึง 20 คน" };
  }

  const session = await openTableSession(tableCode, pax);

  if (!session) {
    return { status: "error", message: "โต๊ะนี้ยังไม่เปิดให้บริการ กรุณาเรียกพนักงาน" };
  }

  // redirect โยน control-flow exception ของ framework โค้ดหลังบรรทัดนี้จะไม่ทำงาน
  redirect(`/t/${tableCode}`);
}

/** ใส่เมนู (พร้อมตัวเลือกที่เลือกไว้) ลงตะกร้าของรอบโต๊ะ */
export async function addToCartAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tableCode = String(formData.get("tableCode") ?? "");
  const context = await resolveCustomerContext(tableCode);

  if (!context?.session) {
    return { status: "error", message: "รอบโต๊ะหมดอายุแล้ว กรุณาสแกน QR ที่โต๊ะใหม่อีกครั้ง" };
  }

  const result = await addToCart({
    tableSessionId: context.session.id,
    branchId: context.branch.id,
    tableId: context.table.id,
    timezone: context.branch.timezone,
    menuItemId: String(formData.get("menuItemId") ?? ""),
    quantity: Number.parseInt(String(formData.get("quantity") ?? "1"), 10),
    // ช่องตัวเลือกทุกช่องใช้ name="modifierId" เหมือนกันหมด ทั้ง radio และ checkbox
    // จึงอ่านด้วย getAll() ครั้งเดียวได้ทุกกลุ่ม
    modifierIds: formData.getAll("modifierId").map(String),
    note: formData.get("note") ? String(formData.get("note")) : null,
  });

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  redirect(`/t/${tableCode}`);
}

/** เพิ่ม/ลดจำนวนในตะกร้า — ส่ง quantity = 0 เพื่อลบบรรทัดนั้นทิ้ง */
export async function setCartLineQuantityAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tableCode = String(formData.get("tableCode") ?? "");
  const context = await resolveCustomerContext(tableCode);

  if (!context?.session) {
    return { status: "error", message: "รอบโต๊ะหมดอายุแล้ว กรุณาสแกน QR ที่โต๊ะใหม่อีกครั้ง" };
  }

  const result = await setCartLineQuantity(
    context.session.id,
    String(formData.get("orderItemId") ?? ""),
    Number.parseInt(String(formData.get("quantity") ?? "0"), 10),
  );

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  // อยู่หน้าตะกร้าต่อ แค่ให้ router ดึงข้อมูลใหม่มาแสดง
  refresh();

  return { status: "success", message: "อัปเดตตะกร้าแล้ว" };
}

/**
 * ส่งออร์เดอร์เข้าครัว
 *
 * กันกดซ้ำสองชั้น: ชั้นบนคือปุ่มที่ disable ตัวเองทันทีด้วย useFormStatus
 * (กัน "กดรัว" ซึ่งเป็นเคสที่เจอบ่อยที่สุด) ชั้นล่างคือ conditional update
 * ที่ status ต้องเป็น DRAFT ใน placeOrder() ซึ่งเป็นชั้นที่เชื่อถือได้จริง
 * เพราะกันได้แม้ POST จะถูกยิงตรงเข้ามาโดยไม่ผ่านหน้าจอของเรา
 */
export async function placeOrderAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const tableCode = String(formData.get("tableCode") ?? "");
  const context = await resolveCustomerContext(tableCode);

  if (!context?.session) {
    return { status: "error", message: "รอบโต๊ะหมดอายุแล้ว กรุณาสแกน QR ที่โต๊ะใหม่อีกครั้ง" };
  }

  const result = await placeOrder(context.session.id);

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  redirect(`/t/${tableCode}/orders`);
}
