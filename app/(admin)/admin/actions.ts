"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/lib/form-state";
import { canAccessScreen } from "@/lib/rbac";
import {
  deleteMenuEntity,
  moveSortOrder,
  setAvailability,
  setMenuItemModifierGroups,
  upsertCategory,
  upsertMenuItem,
  upsertModifierGroup,
  type MenuEntity,
} from "@/lib/server/menu-admin";
import { recordReceiptPrint } from "@/lib/server/receipt";
import { getCurrentStaff, loginStaff, logoutStaff } from "@/lib/server/staff-session";

/**
 * Server Action ของจอหลังร้าน (โมดูล 04)
 *
 * ทุก action เรียก requireAdminStaff() เป็นบรรทัดแรกเสมอ เพราะ action ถูกยิงตรง
 * ด้วย POST ได้ การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์
 *
 * ตัวตรวจสิทธิ์ "ละเอียดกว่าหน้าจอ" อยู่ลึกลงไปที่ lib/server/menu-admin.ts —
 * เข้าจอหลังร้านได้ (ทุกตำแหน่ง) ไม่ได้แปลว่าแก้เมนูได้ (canEditMenu = หัวหน้าเท่านั้น)
 * แคชเชียร์/เสิร์ฟ/ครัว เข้ามากดได้อย่างเดียวคือ "ของหมด / มีของ"
 */

const NOT_SIGNED_IN: FormState = {
  status: "error",
  message: "เซสชันหมดอายุ กรุณาใส่ PIN ใหม่",
};

async function requireAdminStaff() {
  const staff = await getCurrentStaff("admin");
  return staff && canAccessScreen(staff.role, "admin") ? staff : null;
}

export async function adminLoginAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await loginStaff(
    String(formData.get("staffCode") ?? ""),
    String(formData.get("pin") ?? ""),
    "admin",
  );

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  if (!canAccessScreen(result.staff.role, "admin")) {
    // ต้อง logout ทิ้งด้วย ไม่ใช่แค่คืน error — เหตุผลเดียวกับจอครัว: ไม่งั้น
    // cookie ที่เพิ่งออกให้จะค้างอยู่แล้วเดินไปเปิดหน้าอื่นต่อได้โดยไม่ต้องใส่ PIN
    await logoutStaff("admin");
    return { status: "error", message: "ตำแหน่งของคุณไม่มีสิทธิ์เข้าหลังร้าน" };
  }

  redirect("/admin/menu");
}

export async function adminLogoutAction(): Promise<void> {
  await logoutStaff("admin");
  redirect("/admin/login");
}

/**
 * กด "ของหมด / มีของ" — action เดียวใช้ได้ทั้งหมวด เมนู และตัวเลือก
 *
 * รวมเป็นตัวเดียวเพราะทั้งสามอย่างทำสิ่งเดียวกันเป๊ะ (พลิกบูลีนหนึ่งช่อง + เขียน log)
 * ต่างกันแค่ชื่อตาราง ถ้าแยกสามตัวจะได้โค้ดเหมือนกันสามชุดที่ต้องแก้พร้อมกันตลอดไป
 * — ตัว `entity` ถูกตรวจฝั่ง server ว่าเป็นค่าที่รู้จักจริง ไม่ได้เชื่อ form ตรง ๆ
 */
export async function toggleAvailabilityAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await setAvailability(
    staff,
    String(formData.get("entity") ?? "") as MenuEntity,
    String(formData.get("id") ?? ""),
    formData.get("next") === "true",
  );

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  refresh();

  return { status: "success", message: result.available ? "เปิดขายแล้ว" : "ปิดขายแล้ว" };
}

/** เลื่อนลำดับขึ้น/ลงทีละขั้น — ไม่ใช้ drag-and-drop (ดูเหตุผลใน menu-admin.ts) */
export async function moveSortOrderAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await moveSortOrder(
    staff,
    String(formData.get("entity") ?? "") as MenuEntity,
    String(formData.get("id") ?? ""),
    formData.get("direction") === "up" ? "up" : "down",
  );

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  refresh();

  return { status: "success", message: "เรียงลำดับใหม่แล้ว" };
}

export async function saveCategoryAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await upsertCategory(staff, {
    id: optionalText(formData.get("id")),
    name: String(formData.get("name") ?? ""),
  });

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  redirect("/admin/menu");
}

export async function saveMenuItemAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await upsertMenuItem(staff, {
    id: optionalText(formData.get("id")),
    name: String(formData.get("name") ?? ""),
    description: optionalText(formData.get("description")),
    categoryId: String(formData.get("categoryId") ?? ""),
    stationId: optionalText(formData.get("stationId")),
    imageUrl: optionalText(formData.get("imageUrl")),
    /**
     * ส่งมาเป็นข้อความที่พนักงานพิมพ์ ("120" หรือ "120.50") ไม่ใช่จำนวนเต็มหน่วยย่อย
     * — การแปลงเกิดที่ parseMoneyInput() ใน lib/money.ts ที่เดียว และเกิดฝั่ง server
     * เพราะห้ามเชื่อตัวเลขที่ client แปลงมาให้ (กฎเดียวกับตอนรับเงินในบทที่ 11)
     */
    basePriceText: String(formData.get("basePrice") ?? ""),
  });

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  redirect("/admin/menu");
}

/** ผูก/ถอดกลุ่มตัวเลือกของเมนูหนึ่งรายการ — ส่งมาทั้งชุด ไม่ใช่ทีละกลุ่ม */
export async function saveMenuItemGroupsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await setMenuItemModifierGroups(
    staff,
    String(formData.get("menuItemId") ?? ""),
    formData.getAll("modifierGroupId").map(String),
  );

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  refresh();

  return { status: "success", message: "บันทึกกลุ่มตัวเลือกแล้ว" };
}

/**
 * บันทึกกลุ่มตัวเลือกพร้อมตัวเลือกย่อยทั้งกลุ่มในครั้งเดียว
 *
 * ตัวเลือกย่อยส่งมาเป็นอาเรย์ขนาน (`modifierId[]`, `modifierName[]`, `modifierPrice[]`)
 * ซึ่งเป็นวิธีที่ `<form>` ธรรมดาส่งรายการซ้ำได้โดยไม่ต้องพึ่ง JS —
 * ฝั่ง server ต้องเช็คเองว่าทั้งสามอาเรย์ยาวเท่ากัน (ดู upsertModifierGroup)
 */
export async function saveModifierGroupAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await upsertModifierGroup(staff, {
    id: optionalText(formData.get("id")),
    name: String(formData.get("name") ?? ""),
    required: formData.get("required") === "on",
    minSelect: Number.parseInt(String(formData.get("minSelect") ?? "0"), 10),
    maxSelect: Number.parseInt(String(formData.get("maxSelect") ?? "1"), 10),
    modifiers: formData.getAll("modifierName").map((name, index) => ({
      id: optionalText(formData.getAll("modifierId")[index]),
      name: String(name),
      priceDeltaText: String(formData.getAll("modifierPrice")[index] ?? "0"),
    })),
  });

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  redirect("/admin/modifiers");
}

/** ลบจริง — ทำได้เฉพาะของที่ยังไม่เคยถูกสั่ง/ยังไม่ถูกใช้ (ดูกฎใน menu-admin.ts) */
export async function deleteEntityAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const entity = String(formData.get("entity") ?? "") as MenuEntity;
  const result = await deleteMenuEntity(staff, entity, String(formData.get("id") ?? ""));

  if (!result.ok) {
    return { status: "error", message: result.error };
  }

  redirect(entity === "modifierGroup" || entity === "modifier" ? "/admin/modifiers" : "/admin/menu");
}

/** ช่องที่เว้นว่างไว้ต้องเป็น null ไม่ใช่สตริงว่าง — คอลัมน์พวกนี้เป็น nullable ใน DB */
function optionalText(value: FormDataEntryValue | null | undefined): string | null {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text === "" ? null : text;
}

/**
 * บันทึกการพิมพ์ใบเสร็จจากจอหลังร้าน (บทที่ 12)
 *
 * คู่แฝดของ posPrintReceiptAction() ใน app/(pos)/pos/actions.ts —
 * ต่างกันที่ cookie ที่อ่านเท่านั้น ดูเหตุผลที่ไม่รวมเป็นตัวเดียวในไฟล์นั้น
 */
export async function adminPrintReceiptAction(
  receiptId: string,
): Promise<{ ok: boolean; error?: string }> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return { ok: false, error: "เซสชันหมดอายุ กรุณาใส่ PIN ใหม่" };
  }

  const result = await recordReceiptPrint(staff, receiptId);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  refresh();

  return { ok: true };
}
