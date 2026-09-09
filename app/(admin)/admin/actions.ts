"use server";

import { countKey } from "@/lib/i18n/translate";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { formError, type FormState } from "@/lib/form-state";
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
import {
  createStaffMember,
  resetStaffPin,
  revokeStaffSessions,
  updateStaffMember,
} from "@/lib/server/staff-admin";
import type { Currency, SalePointKind, StaffRole } from "@/lib/generated/prisma/enums";
import {
  deleteStation,
  deleteTable,
  rotateTableCode,
  updateBusinessInfo,
  updateTaxSettings,
  upsertStation,
  upsertTable,
} from "@/lib/server/settings";
import { getCurrentStaff, loginStaff, logoutStaff } from "@/lib/server/staff-session";
import type { MessageParams } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

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
  messageKey: "error.session_expired",
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
    return formError(result);
  }

  if (!canAccessScreen(result.staff.role, "admin")) {
    // ต้อง logout ทิ้งด้วย ไม่ใช่แค่คืน error — เหตุผลเดียวกับจอครัว: ไม่งั้น
    // cookie ที่เพิ่งออกให้จะค้างอยู่แล้วเดินไปเปิดหน้าอื่นต่อได้โดยไม่ต้องใส่ PIN
    await logoutStaff("admin");
    return { status: "error", messageKey: "error.no_access_admin" };
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
    return formError(result);
  }

  refresh();

  return {
    status: "success",
    messageKey: result.available ? "msg.item_available" : "msg.item_unavailable",
  };
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
    return formError(result);
  }

  refresh();

  return { status: "success", messageKey: "msg.reordered" };
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
    return formError(result);
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
    return formError(result);
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
    return formError(result);
  }

  refresh();

  return { status: "success", messageKey: "msg.modifier_group_saved" };
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
    return formError(result);
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
    return formError(result);
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
): Promise<{ ok: boolean; errorKey?: MessageKey; params?: MessageParams }> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return { ok: false, errorKey: "error.session_expired" };
  }

  const result = await recordReceiptPrint(staff, receiptId);

  if (!result.ok) {
    return { ok: false, errorKey: result.errorKey };
  }

  refresh();

  return { ok: true };
}

/**
 * ── จัดการพนักงาน (บทที่ 13b) ────────────────────────────────────────────
 *
 * ทุกตัวเรียก `requireAdminStaff()` ก่อน แล้วส่งต่อให้ `lib/server/staff-admin.ts`
 * ซึ่งเป็นที่ที่บังคับสิทธิ์ "ละเอียดกว่าหน้าจอ" อีกชั้น (ตำแหน่งไหนแก้ตำแหน่งไหนได้)
 * — action พวกนี้จึงไม่ตัดสินใจเรื่องสิทธิ์เองเลย นอกจากด่านเข้าจอ
 */
export async function createStaffAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await createStaffMember(staff, {
    code: String(formData.get("code") ?? ""),
    name: String(formData.get("name") ?? ""),
    role: String(formData.get("role") ?? "SERVER") as StaffRole,
    pin: String(formData.get("pin") ?? ""),
  });

  if (!result.ok) {
    return formError(result);
  }

  redirect(`/admin/staff/${result.staffId}`);
}

export async function updateStaffAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await updateStaffMember(staff, String(formData.get("staffId") ?? ""), {
    code: String(formData.get("code") ?? ""),
    name: String(formData.get("name") ?? ""),
    role: String(formData.get("role") ?? "SERVER") as StaffRole,
    isActive: formData.get("isActive") === "on",
  });

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return {
    status: "success",
    messageKey: result.revokedSessions
      ? countKey("msg.saved_revoked", result.revokedSessions)
      : "msg.saved",
    params: { count: result.revokedSessions },
  };
}

export async function resetStaffPinAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await resetStaffPin(
    staff,
    String(formData.get("staffId") ?? ""),
    String(formData.get("pin") ?? ""),
  );

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  /**
   * บอกจำนวนเครื่องที่หลุดออกไปด้วย ไม่ใช่แค่ "สำเร็จ" — เพราะนั่นคือสิ่งที่
   * ผู้จัดการต้องรู้ทันที: ถ้าเลขไม่ใช่ศูนย์ แปลว่ามีเครื่องเปิดค้างอยู่จริง
   * ซึ่งอาจเป็นเครื่องที่ตั้งใจตามหาอยู่พอดี
   */
  return {
    status: "success",
    messageKey: result.revokedSessions
      ? countKey("msg.pin_reset_revoked", result.revokedSessions)
      : "msg.pin_reset",
    params: { count: result.revokedSessions },
  };
}

export async function revokeStaffSessionsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await revokeStaffSessions(staff, String(formData.get("staffId") ?? ""));

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return {
    status: "success",
    messageKey: result.revokedSessions
      ? countKey("msg.revoked", result.revokedSessions)
      : "msg.no_active_sessions",
    params: { count: result.revokedSessions },
  };
}

/**
 * ── ตั้งค่าร้าน (spec §22 §23 §24) ────────────────────────────────────────
 *
 * แยกเป็นสาม action ตามสามแผงบนหน้าจอ ไม่ใช่ action เดียวที่รับทุกช่อง เพราะ
 * **สามแผงนี้คนละสิทธิ์กัน** (อัตราภาษี = เจ้าของร้านเท่านั้น) และการรวมเป็น
 * ฟอร์มเดียวแปลว่าผู้จัดการที่กดบันทึกที่อยู่ร้านจะยิงค่าอัตราภาษีไปด้วยทุกครั้ง
 */
export async function updateTaxSettingsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await updateTaxSettings(staff, {
    // ช่องกรอกเป็น "เปอร์เซ็นต์" ที่คนอ่านออก แต่ที่เก็บเป็น basis point จำนวนเต็ม
    vatRateBp: percentToBp(formData.get("vatRatePercent")),
    serviceChargeBp: percentToBp(formData.get("serviceChargePercent")),
    staffMealDiscountBp: percentToBp(formData.get("staffMealDiscountPercent")),
    pricesIncludeVat: formData.get("pricesIncludeVat") === "on",
    currency: String(formData.get("currency") ?? "THB") as Currency,
    timezone: String(formData.get("timezone") ?? "Asia/Bangkok"),
  });

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return {
    status: "success",
    messageKey: result.changed ? "msg.rates_saved" : "msg.unchanged",
  };
}

export async function updateBusinessInfoAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await updateBusinessInfo(staff, {
    tenantName: String(formData.get("tenantName") ?? ""),
    taxId: String(formData.get("taxId") ?? ""),
    branchName: String(formData.get("branchName") ?? ""),
    addressLine: String(formData.get("addressLine") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    receiptFooter: String(formData.get("receiptFooter") ?? ""),
  });

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return {
    status: "success",
    messageKey: result.changed ? "msg.business_saved" : "msg.unchanged",
  };
}

export async function upsertStationAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const stationId = String(formData.get("stationId") ?? "");

  const result = await upsertStation(staff, stationId || null, {
    code: String(formData.get("code") ?? ""),
    name: String(formData.get("name") ?? ""),
    sortOrder: Number.parseInt(String(formData.get("sortOrder") ?? "0"), 10) || 0,
    isActive: formData.get("isActive") === "on",
  });

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return {
    status: "success",
    messageKey: stationId ? "msg.station_saved" : "msg.station_added",
  };
}

export async function deleteStationAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await deleteStation(staff, String(formData.get("stationId") ?? ""));

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return { status: "success", messageKey: "msg.station_deleted" };
}

/**
 * "7.5" (เปอร์เซ็นต์ที่คนกรอก) → 750 (basis point ที่ระบบเก็บ)
 *
 * แยกสตริงที่จุดทศนิยมแล้วประกอบเป็นจำนวนเต็มเอง **ห้ามคูณ 100 แบบ float**
 * ด้วยเหตุผลเดียวกับ `parseMoneyInput()` ใน lib/money.ts — `7.5 * 100` ให้
 * 750.0000000000001 ในบางค่า แล้วอัตราภาษีของร้านจะเพี้ยนแบบที่ไม่มีใครหาเจอ
 *
 * คืน NaN เมื่อรูปแบบผิด เพื่อให้ชั้น lib/server/settings.ts เป็นคนปฏิเสธ
 * ที่เดียว (มันตรวจ Number.isInteger อยู่แล้ว) ไม่ใช่เงียบ ๆ กลายเป็น 0
 */
function percentToBp(raw: FormDataEntryValue | null): number {
  const text = String(raw ?? "").trim();

  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return Number.NaN;
  }

  const [whole, fraction = ""] = text.split(".");
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
}

/**
 * ── จุดขาย (โต๊ะ / เคาน์เตอร์ / ช่องไรเดอร์) ────────────────────────────────
 *
 * `kind` รับจากฟอร์มได้ที่นี่ **ที่เดียว** และเป็นข้อยกเว้นที่ตั้งใจ:
 * ทุกที่อื่นในระบบห้ามให้หน้าจอส่ง `kind`/`Order.type` มา เพราะมันคือตัวชี้ว่า
 * บิลคิดค่าบริการหรือไม่ (ยิง POST ตัด 10% ทิ้งได้) — แต่ตรงนี้คือหน้าที่
 * **สร้างตัวจุดขายเอง** ค่านั้นจึงต้องมาจากคนกรอก และถูกล็อกทันทีที่มีประวัติขาย
 * (ดู upsertTable ใน lib/server/settings.ts)
 */
function parseSalePointKind(value: FormDataEntryValue | null): SalePointKind {
  return value === "COUNTER" || value === "DELIVERY" ? value : "DINE_IN";
}

export async function upsertTableAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const tableId = String(formData.get("tableId") ?? "");

  const result = await upsertTable(staff, tableId || null, {
    name: String(formData.get("name") ?? ""),
    seats: Number.parseInt(String(formData.get("seats") ?? "0"), 10) || 0,
    sortOrder: Number.parseInt(String(formData.get("sortOrder") ?? "0"), 10) || 0,
    kind: parseSalePointKind(formData.get("kind")),
    isActive: formData.get("isActive") === "on",
  });

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return {
    status: "success",
    // ตอนสร้างใหม่ต้องบอกรหัส QR ออกมาเลย เพราะเป็นสิ่งที่คนกดต้องเอาไปพิมพ์ต่อทันที
    messageKey: tableId ? "msg.sale_point_saved" : "msg.sale_point_added",
    params: { code: result.tableCode ?? "" },
  };
}

export async function rotateTableCodeAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await rotateTableCode(staff, String(formData.get("tableId") ?? ""));

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return {
    status: "success",
    messageKey: "msg.qr_reissued",
    params: { code: result.tableCode ?? "" },
  };
}

export async function deleteTableAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireAdminStaff();

  if (!staff) {
    return NOT_SIGNED_IN;
  }

  const result = await deleteTable(staff, String(formData.get("tableId") ?? ""));

  if (!result.ok) {
    return formError(result);
  }

  refresh();

  return { status: "success", messageKey: "msg.sale_point_deleted" };
}
