import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { parseMoneyInput } from "@/lib/money";
import { canEditMenu, canToggleMenuAvailability } from "@/lib/rbac";
import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";
import type { MessageParams } from "@/lib/i18n/translate";
import { countKey } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

/**
 * จัดการเมนูจากหลังร้าน (โมดูล 04)
 *
 * ── ทำไมไม่ยัดลง lib/server/menu.ts ────────────────────────────────────
 * ไฟล์นั้นเป็นทาง "อ่าน" ของหน้าลูกค้า ซึ่งกรอง `isAvailable = true` ทุกชั้น
 * ตั้งแต่ใน query เป็นกฎประจำไฟล์ แต่หลังร้านต้องเห็นของที่ปิดขายอยู่ด้วย
 * (ไม่งั้นจะเปิดกลับไม่ได้เลย) ถ้าเอามารวมไฟล์เดียวจะเกิด flag
 * `includeUnavailable` วิ่งไปทุกฟังก์ชัน แล้ววันหนึ่งจะมีใครลืมส่ง
 * แล้วเมนูที่ปิดอยู่จะโผล่บนมือถือลูกค้าโดยไม่มีอะไรฟ้อง
 *
 * ── กฎประจำไฟล์นี้ ─────────────────────────────────────────────────────
 * 1. ทุกฟังก์ชันที่เขียนข้อมูลรับ `staff` แล้วตรวจสิทธิ์เองเป็นบรรทัดแรก
 * 2. ทุก query กรอง `staff.branchId` เสมอ — id ที่ส่งมาจากฟอร์มเชื่อไม่ได้
 * 3. ทุกการเปลี่ยนแปลงเขียน `AuditLog` **ในทรานแซกชันเดียวกัน**
 *    และเก็บค่าก่อน-หลังของราคาเสมอ (ช่องโกงหลักตามที่เล่มเตือนไว้ในบทที่ 13)
 * 4. `publishRealtimeEvent()` เรียกหลัง commit เท่านั้น ห้ามเรียกใน $transaction
 */

/** ชนิดของสิ่งที่แก้ได้ในหลังร้าน — ใช้เป็นตัวเลือกในฟอร์มที่ใช้ action ร่วมกัน */
export type MenuEntity = "category" | "menuItem" | "modifierGroup" | "modifier";

const MENU_ENTITIES: readonly MenuEntity[] = [
  "category",
  "menuItem",
  "modifierGroup",
  "modifier",
];

/** ป้ายภาษาไทยของแต่ละชนิด ใช้ในข้อความ error และ AuditLog */
/**
 * คีย์ข้อความ "ไม่พบ<ของ>ในสาขาของคุณ" ต่อชนิดของ entity
 *
 * เดิมเป็นคำนามภาษาอังกฤษที่เอาไปแทรกกลางประโยค — ทำแบบนั้นข้ามภาษาไม่ได้
 * เพราะเวียดนามเรียงคำต่างออกไป และคำนามเองก็ต้องแปล
 */
const ENTITY_NOT_FOUND_KEY: Record<MenuEntity, MessageKey> = {
  category: "error.entity_not_found.category",
  menuItem: "error.entity_not_found.menuItem",
  modifierGroup: "error.entity_not_found.modifierGroup",
  modifier: "error.entity_not_found.modifier",
};

/** ความล้มเหลวหนึ่งครั้ง = คีย์ + ค่าที่ต้องแทรก (ไม่ใช่ประโยค) */
type MenuFailure = { errorKey: MessageKey; params?: MessageParams };

export type MenuAdminResult<T = object> = ({ ok: true } & T) | { ok: false; errorKey: MessageKey; params?: MessageParams };

// ─────────────────────────────────────────────────────────────────────────────
// อ่าน
// ─────────────────────────────────────────────────────────────────────────────

export type MenuTree = Awaited<ReturnType<typeof getMenuTree>>;
export type MenuItemForEdit = NonNullable<Awaited<ReturnType<typeof getMenuItemForEdit>>>;
export type AdminModifierGroups = Awaited<ReturnType<typeof getModifierGroups>>;

/**
 * หมวดทั้งหมด → เมนูในหมวด (รวมของที่ปิดขายอยู่)
 *
 * เรียงด้วย `[sortOrder, name]` เหมือนหน้าลูกค้าเป๊ะ ๆ เพื่อให้สิ่งที่หลังร้านเห็น
 * คือลำดับเดียวกับที่ลูกค้าเห็นจริง — ถ้าเรียงคนละแบบ ปุ่มเลื่อนขึ้น/ลงจะกลายเป็น
 * การเดาว่าผลจะออกมาหน้าตายังไงบนมือถือลูกค้า
 */
export async function getMenuTree(branchId: string) {
  return prisma.menuCategory.findMany({
    where: { branchId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          station: { select: { name: true } },
          // นับกลุ่มตัวเลือกที่ผูกอยู่ เพื่อบอกบนลิสต์ว่าเมนูไหนมีตัวเลือกให้เลือกบ้าง
          _count: { select: { modifierGroups: true } },
        },
      },
    },
  });
}

/** เมนูหนึ่งรายการ + ของที่ต้องใช้เติมฟอร์ม (หมวด/สถานี/กลุ่มตัวเลือกทั้งหมด) */
export async function getMenuItemForEdit(branchId: string, menuItemId: string | null) {
  const [categories, stations, groups] = await Promise.all([
    prisma.menuCategory.findMany({
      where: { branchId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, isAvailable: true },
    }),
    prisma.station.findMany({
      where: { branchId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.modifierGroup.findMany({
      where: { branchId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true, required: true },
    }),
  ]);

  const item = menuItemId
    ? await prisma.menuItem.findFirst({
        where: { id: menuItemId, branchId },
        include: {
          modifierGroups: { select: { modifierGroupId: true }, orderBy: { sortOrder: "asc" } },
        },
      })
    : null;

  // ขอแก้เมนูที่ไม่มีจริง (หรือของสาขาอื่น) → คืน null ให้หน้าจอ notFound()
  if (menuItemId && !item) {
    return null;
  }

  return { item, categories, stations, groups };
}

/** กลุ่มตัวเลือกทั้งหมด + ตัวเลือกย่อย + จำนวนเมนูที่ใช้กลุ่มนั้นอยู่ */
export async function getModifierGroups(branchId: string) {
  return prisma.modifierGroup.findMany({
    where: { branchId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      modifiers: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      _count: { select: { menuItems: true } },
    },
  });
}

export type ModifierGroupForEdit = NonNullable<Awaited<ReturnType<typeof getModifierGroup>>>;

export async function getModifierGroup(branchId: string, groupId: string) {
  return prisma.modifierGroup.findFirst({
    where: { id: groupId, branchId },
    include: { modifiers: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// เปิด/ปิดขาย
// ─────────────────────────────────────────────────────────────────────────────

/**
 * กด "ของหมด / มีของ" — งานเดียวที่พนักงานหน้าร้านและครัวทำได้บนจอนี้
 *
 * ⚠ คอลัมน์ที่เก็บสถานะ **ไม่ใช่ชื่อเดียวกันทุกตาราง**: หมวด/เมนู/ตัวเลือก ใช้
 * `isAvailable` แต่กลุ่มตัวเลือกใช้ `isActive` (เพราะกลุ่มไม่ใช่ของที่ "ขายหมด" ได้
 * มันคือกฎการเลือกที่เปิด/ปิดใช้งาน) — ตรงนี้คือจุดที่ลืมแล้วจะแก้ผิดตารางเงียบ ๆ
 */
export async function setAvailability(
  staff: CurrentStaff,
  entity: MenuEntity,
  id: string,
  next: boolean,
): Promise<MenuAdminResult<{ available: boolean }>> {
  if (!canToggleMenuAvailability(staff.role)) {
    return { ok: false, errorKey: "error.cannot_edit_menu" as const };
  }

  if (!MENU_ENTITIES.includes(entity)) {
    return { ok: false, errorKey: "error.unknown_entity_edit" as const };
  }

  const found = await findEntity(staff.branchId, entity, id);

  if (!found) {
    return { ok: false, errorKey: ENTITY_NOT_FOUND_KEY[entity] };
  }

  await prisma.$transaction(async (tx) => {
    switch (entity) {
      case "category":
        await tx.menuCategory.update({ where: { id }, data: { isAvailable: next } });
        break;
      case "menuItem":
        await tx.menuItem.update({ where: { id }, data: { isAvailable: next } });
        break;
      case "modifierGroup":
        await tx.modifierGroup.update({ where: { id }, data: { isActive: next } });
        break;
      case "modifier":
        await tx.modifier.update({ where: { id }, data: { isAvailable: next } });
        break;
    }

    await writeAudit(tx, staff, `menu.${entity}.availability`, entity, id, {
      name: found.name,
      before: found.available,
      after: next,
    });
  });

  await announceMenuChanged(staff.branchId);

  return { ok: true, available: next };
}

// ─────────────────────────────────────────────────────────────────────────────
// เรียงลำดับ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * เลื่อนขึ้น/ลงทีละขั้น — ตั้งใจไม่ทำ drag-and-drop
 *
 * ปุ่มขึ้น/ลงทำงานได้แม้ JS ยังไม่โหลด ไม่ต้องมี client state และกดพลาดยาก
 * บนแท็บเล็ตที่มือเปียก ส่วน drag-and-drop ต้องมี pointer event + optimistic UI
 * ซึ่งเป็นความซับซ้อนที่ไม่ได้ซื้ออะไรเพิ่มสำหรับลิสต์หลักสิบแถว
 *
 * ── ทำไมต้องเขียน sortOrder ใหม่ทั้งชุด ไม่ใช่สลับค่าสองแถว ──────────────
 * `sortOrder` **ไม่มี unique constraint** และ seed ก็ไม่ได้การันตีว่าไม่ซ้ำ
 * ถ้าสองแถวบังเอิญมีค่าเท่ากันแล้วเราแค่ "สลับค่า" ผลลัพธ์คือไม่มีอะไรขยับเลย
 * แล้วปุ่มจะดูเหมือนเสียโดยไม่มี error — จึงเรียงด้วย `[sortOrder, id]` ให้ได้
 * ลำดับที่แน่นอนก่อน สลับตำแหน่งในอาเรย์ แล้วเขียนเลขใหม่ให้ทุกแถวที่เปลี่ยน
 * (เท่ากับล้างค่าซ้ำทิ้งไปในตัว)
 */
export async function moveSortOrder(
  staff: CurrentStaff,
  entity: MenuEntity,
  id: string,
  direction: "up" | "down",
): Promise<MenuAdminResult> {
  if (!canEditMenu(staff.role)) {
    return { ok: false, errorKey: "error.cannot_reorder_menu" as const };
  }

  const siblings = await loadSiblings(staff.branchId, entity, id);

  if (!siblings) {
    return { ok: false, errorKey: ENTITY_NOT_FOUND_KEY[entity] };
  }

  const index = siblings.findIndex((row) => row.id === id);
  const target = direction === "up" ? index - 1 : index + 1;

  if (target < 0 || target >= siblings.length) {
    // อยู่บนสุด/ล่างสุดอยู่แล้ว — ไม่ใช่ error ที่ต้องขึ้นหน้าจอสีแดง
    return { ok: true };
  }

  const reordered = [...siblings];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

  await prisma.$transaction(async (tx) => {
    for (const [position, row] of reordered.entries()) {
      const nextSortOrder = position + 1;

      if (row.sortOrder === nextSortOrder) {
        continue;
      }

      await updateSortOrder(tx, entity, row.id, nextSortOrder);
    }

    await writeAudit(tx, staff, `menu.${entity}.reorder`, entity, id, {
      direction,
      from: index + 1,
      to: target + 1,
    });
  });

  await announceMenuChanged(staff.branchId);

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// สร้าง / แก้
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertCategory(
  staff: CurrentStaff,
  input: { id: string | null; name: string },
): Promise<MenuAdminResult<{ id: string }>> {
  if (!canEditMenu(staff.role)) {
    return { ok: false, errorKey: "error.cannot_edit_category" as const };
  }

  const name = input.name.trim();

  if (name.length < 1) {
    return { ok: false, errorKey: "error.category_name_required" as const };
  }

  const existing = input.id
    ? await prisma.menuCategory.findFirst({ where: { id: input.id, branchId: staff.branchId } })
    : null;

  if (input.id && !existing) {
    return { ok: false, errorKey: "error.category_not_found" as const };
  }

  const id = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.menuCategory.update({ where: { id: existing.id }, data: { name } });

      await writeAudit(tx, staff, "menu.category.update", "category", existing.id, {
        before: { name: existing.name },
        after: { name },
      });

      return existing.id;
    }

    const created = await tx.menuCategory.create({
      data: {
        branchId: staff.branchId,
        name,
        sortOrder: await nextSortOrder(tx, "category", staff.branchId, null),
      },
    });

    await writeAudit(tx, staff, "menu.category.create", "category", created.id, { name });

    return created.id;
  });

  await announceMenuChanged(staff.branchId);

  return { ok: true, id };
}

export async function upsertMenuItem(
  staff: CurrentStaff,
  input: {
    id: string | null;
    name: string;
    description: string | null;
    categoryId: string;
    stationId: string | null;
    imageUrl: string | null;
    basePriceText: string;
  },
): Promise<MenuAdminResult<{ id: string }>> {
  if (!canEditMenu(staff.role)) {
    return { ok: false, errorKey: "error.cannot_edit_item" as const };
  }

  const name = input.name.trim();

  if (name.length < 1) {
    return { ok: false, errorKey: "error.item_name_required" as const };
  }

  /**
   * ราคาเป็นข้อความที่พนักงานพิมพ์ ("120" / "120.50") แปลงฝั่ง server ที่นี่เท่านั้น
   * — ห้ามให้ client แปลงมาให้ (กฎเดียวกับตอนรับเงินในบทที่ 11) และ
   * `parseMoneyInput()` รับเลขติดลบได้ จึงต้องกันเองว่าราคาเมนูติดลบไม่ได้
   */
  const basePrice = parseMoneyInput(input.basePriceText, staff.branch.currency);

  if (basePrice === null) {
    return { ok: false, errorKey: "error.price_invalid" as const };
  }

  if (basePrice < 0) {
    return { ok: false, errorKey: "error.price_negative" as const };
  }

  if (input.imageUrl !== null && !isUsableImageUrl(input.imageUrl)) {
    return { ok: false, errorKey: "error.image_url_invalid" as const };
  }

  const category = await prisma.menuCategory.findFirst({
    where: { id: input.categoryId, branchId: staff.branchId },
    select: { id: true },
  });

  if (!category) {
    return { ok: false, errorKey: "error.category_required" as const };
  }

  // สถานีต้องเป็นของสาขาเดียวกัน ไม่งั้นออร์เดอร์จะไปโผล่บนจอครัวของอีกสาขา
  if (input.stationId) {
    const station = await prisma.station.findFirst({
      where: { id: input.stationId, branchId: staff.branchId },
      select: { id: true },
    });

    if (!station) {
      return { ok: false, errorKey: "error.station_not_found" as const };
    }
  }

  const existing = input.id
    ? await prisma.menuItem.findFirst({ where: { id: input.id, branchId: staff.branchId } })
    : null;

  if (input.id && !existing) {
    return { ok: false, errorKey: "error.item_not_found" as const };
  }

  const data = {
    name,
    description: input.description,
    categoryId: input.categoryId,
    stationId: input.stationId,
    imageUrl: input.imageUrl,
    basePrice,
  };

  const id = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.menuItem.update({ where: { id: existing.id }, data });

      /**
       * เก็บ "ราคาก่อน-หลัง" เสมอ แม้ราคาจะไม่เปลี่ยนก็ตาม
       * เพราะสิ่งที่ต้องตอบให้ได้ย้อนหลังคือ "ราคาช่วงนั้นเป็นเท่าไหร่" ไม่ใช่แค่
       * "ครั้งไหนที่มีการเปลี่ยน" — การขึ้นราคาแล้วลดกลับภายในสิบนาทีจะเห็นเป็น
       * สองแถวที่อ่านเรียงกันได้ทันที (เคสโกงที่เล่มยกไว้ในบทที่ 13)
       */
      await writeAudit(tx, staff, "menu.menuItem.update", "menuItem", existing.id, {
        before: {
          name: existing.name,
          basePrice: existing.basePrice,
          categoryId: existing.categoryId,
          stationId: existing.stationId,
        },
        after: {
          name,
          basePrice,
          categoryId: input.categoryId,
          stationId: input.stationId,
        },
      });

      return existing.id;
    }

    const created = await tx.menuItem.create({
      data: {
        ...data,
        branchId: staff.branchId,
        sortOrder: await nextSortOrder(tx, "menuItem", staff.branchId, input.categoryId),
      },
    });

    await writeAudit(tx, staff, "menu.menuItem.create", "menuItem", created.id, {
      name,
      basePrice,
      categoryId: input.categoryId,
    });

    return created.id;
  });

  await announceMenuChanged(staff.branchId);

  return { ok: true, id };
}

/**
 * ผูก/ถอดกลุ่มตัวเลือกของเมนูหนึ่งรายการ — รับมา "ทั้งชุด" ไม่ใช่ทีละกลุ่ม
 *
 * ทำแบบลบทิ้งแล้วสร้างใหม่ทั้งชุดในทรานแซกชันเดียว เพราะตารางกลางมี `sortOrder`
 * ที่เป็นค่าเฉพาะคู่เมนู-กลุ่ม การอัปเดตทีละแถวจะต้องคิดว่าลำดับที่เหลือเลื่อนยังไง
 * ส่วนแบบนี้ลำดับคือลำดับที่ติ๊กมาบนฟอร์มตรง ๆ อ่านง่ายกว่าและไม่มีสถานะกลางที่ผิด
 */
export async function setMenuItemModifierGroups(
  staff: CurrentStaff,
  menuItemId: string,
  groupIds: string[],
): Promise<MenuAdminResult> {
  if (!canEditMenu(staff.role)) {
    return { ok: false, errorKey: "error.cannot_edit_item" as const };
  }

  const item = await prisma.menuItem.findFirst({
    where: { id: menuItemId, branchId: staff.branchId },
    select: { id: true, name: true },
  });

  if (!item) {
    return { ok: false, errorKey: "error.item_not_found" as const };
  }

  // ตัด id ซ้ำทิ้ง แล้วยืนยันว่าทุกกลุ่มเป็นของสาขานี้จริง (ฟอร์มยิงตรงมาได้)
  const wanted = [...new Set(groupIds)];
  const groups = await prisma.modifierGroup.findMany({
    where: { id: { in: wanted }, branchId: staff.branchId },
    select: { id: true },
  });

  if (groups.length !== wanted.length) {
    return { ok: false, errorKey: "error.modifier_groups_foreign" as const };
  }

  await prisma.$transaction(async (tx) => {
    await tx.menuItemModifierGroup.deleteMany({ where: { menuItemId } });

    if (wanted.length > 0) {
      await tx.menuItemModifierGroup.createMany({
        data: wanted.map((modifierGroupId, index) => ({
          menuItemId,
          modifierGroupId,
          sortOrder: index + 1,
        })),
      });
    }

    await writeAudit(tx, staff, "menu.menuItem.groups", "menuItem", menuItemId, {
      name: item.name,
      modifierGroupIds: wanted,
    });
  });

  await announceMenuChanged(staff.branchId);

  return { ok: true };
}

export async function upsertModifierGroup(
  staff: CurrentStaff,
  input: {
    id: string | null;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    modifiers: { id: string | null; name: string; priceDeltaText: string }[];
  },
): Promise<MenuAdminResult<{ id: string }>> {
  if (!canEditMenu(staff.role)) {
    return { ok: false, errorKey: "error.cannot_edit_modifier_group" as const };
  }

  const name = input.name.trim();

  if (name.length < 1) {
    return { ok: false, errorKey: "error.modifier_group_name_required" as const };
  }

  // แถวที่เว้นชื่อไว้ว่างถือว่าไม่ได้ตั้งใจเพิ่ม (ฟอร์มมีช่องว่างรอไว้ให้กรอกเสมอ)
  const rows = input.modifiers.filter((modifier) => modifier.name.trim() !== "");

  if (rows.length === 0) {
    return { ok: false, errorKey: "error.group_needs_option" as const };
  }

  const parsed: { id: string | null; name: string; priceDelta: number }[] = [];

  for (const row of rows) {
    const priceDelta = parseMoneyInput(row.priceDeltaText.trim() || "0", staff.branch.currency);

    if (priceDelta === null) {
      return {
        ok: false,
        errorKey: "error.modifier_price_delta_invalid" as const,
        params: { name: row.name.trim() },
      };
    }

    parsed.push({ id: row.id, name: row.name.trim(), priceDelta });
  }

  const validation = validateSelectionRules({
    required: input.required,
    minSelect: input.minSelect,
    maxSelect: input.maxSelect,
    optionCount: parsed.length,
  });

  if (validation) {
    return { ok: false, errorKey: validation.errorKey, params: validation.params };
  }

  const existing = input.id
    ? await prisma.modifierGroup.findFirst({
        where: { id: input.id, branchId: staff.branchId },
        include: { modifiers: true },
      })
    : null;

  if (input.id && !existing) {
    return { ok: false, errorKey: "error.modifier_group_not_found" as const };
  }

  const id = await prisma.$transaction(async (tx) => {
    const groupData = {
      name,
      required: input.required,
      minSelect: input.minSelect,
      maxSelect: input.maxSelect,
    };

    const groupId = existing
      ? (await tx.modifierGroup.update({ where: { id: existing.id }, data: groupData })).id
      : (
          await tx.modifierGroup.create({
            data: {
              ...groupData,
              branchId: staff.branchId,
              sortOrder: await nextSortOrder(tx, "modifierGroup", staff.branchId, null),
            },
          })
        ).id;

    const keptIds: string[] = [];

    for (const [index, row] of parsed.entries()) {
      const current = existing?.modifiers.find((modifier) => modifier.id === row.id);

      if (current) {
        await tx.modifier.update({
          where: { id: current.id },
          data: { name: row.name, priceDelta: row.priceDelta, sortOrder: index + 1 },
        });
        keptIds.push(current.id);
        continue;
      }

      const created = await tx.modifier.create({
        data: {
          branchId: staff.branchId,
          modifierGroupId: groupId,
          name: row.name,
          priceDelta: row.priceDelta,
          sortOrder: index + 1,
        },
      });
      keptIds.push(created.id);
    }

    /**
     * ตัวเลือกที่ถูกลบออกจากฟอร์ม — **ปิดขายแทนการลบจริงเสมอ**
     *
     * เพราะ `OrderItemModifier` อ้าง `Modifier` ด้วย `onDelete: Restrict`
     * ถ้าลบตัวที่เคยถูกสั่ง Postgres จะโยน FK error ออกมากลางการบันทึกฟอร์ม
     * แล้วงานที่เหลือทั้งชุดจะ rollback ทิ้งโดยพนักงานไม่รู้ว่าเพราะอะไร
     * — การลบจริงมีทางเดียวคือปุ่มลบของตัวมันเอง ซึ่งเช็คก่อนว่าเคยถูกสั่งไหม
     */
    const removed = (existing?.modifiers ?? []).filter(
      (modifier) => !keptIds.includes(modifier.id),
    );

    for (const modifier of removed) {
      await tx.modifier.update({ where: { id: modifier.id }, data: { isAvailable: false } });
    }

    await writeAudit(
      tx,
      staff,
      existing ? "menu.modifierGroup.update" : "menu.modifierGroup.create",
      "modifierGroup",
      groupId,
      {
        name,
        required: input.required,
        minSelect: input.minSelect,
        maxSelect: input.maxSelect,
        before: existing
          ? existing.modifiers.map((modifier) => ({
              name: modifier.name,
              priceDelta: modifier.priceDelta,
            }))
          : null,
        after: parsed.map((row) => ({ name: row.name, priceDelta: row.priceDelta })),
        deactivated: removed.map((modifier) => modifier.name),
      },
    );

    return groupId;
  });

  await announceMenuChanged(staff.branchId);

  return { ok: true, id };
}

/**
 * กฎการเลือกที่ต้องกันไว้ฝั่ง server เสมอ (ฟอร์มยิงตรงด้วย POST ได้)
 *
 * ข้อที่สำคัญที่สุดคือข้อสุดท้าย: `minSelect` มากกว่าจำนวนตัวเลือกที่มีจริง
 * = ลูกค้าจะติดอยู่หน้าเลือกตัวเลือกโดยกด "ใส่ตะกร้า" ไม่ผ่านตลอดกาล
 * **และมันพังที่หน้าลูกค้า ไม่ใช่ที่หน้าที่กดแก้** จึงไม่มีใครรู้จนกว่าจะมีคนบ่น
 */
function validateSelectionRules(input: {
  required: boolean;
  minSelect: number;
  maxSelect: number;
  optionCount: number;
}): MenuFailure | null {
  const { required, minSelect, maxSelect, optionCount } = input;

  if (!Number.isInteger(minSelect) || !Number.isInteger(maxSelect)) {
    return { errorKey: "error.selection_counts_integer" as const };
  }

  if (minSelect < 0) {
    return { errorKey: "error.selection_min_negative" as const };
  }

  if (maxSelect < 1) {
    return { errorKey: "error.selection_max_min1" as const };
  }

  if (maxSelect < minSelect) {
    return { errorKey: "error.selection_max_lt_min" as const };
  }

  if (required && minSelect < 1) {
    return { errorKey: "error.selection_required_min1" as const };
  }

  if (minSelect > optionCount) {
    return {
      errorKey: "error.selection_min_gt_options" as const,
      params: { min: minSelect, count: optionCount },
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ลบ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ลบจริง — ทำได้เฉพาะของที่ "ยังไม่เคยถูกใช้" เท่านั้น
 *
 * ── ทำไมไม่ห้ามลบไปเลยทั้งหมด ────────────────────────────────────────────
 * เมนูที่พิมพ์ชื่อผิดหรือสร้างไว้ทดลอง ถ้าลบไม่ได้เลยจะค้างอยู่ในลิสต์ตลอดกาล
 * แล้วหลังร้านจะรกจนคนเลิกใช้ — ของที่ไม่มีประวัติผูกอยู่ ลบได้และควรลบได้
 *
 * ── ทำไมไม่ปล่อยให้ DB เป็นคนห้าม ───────────────────────────────────────
 * `onDelete: Restrict` ห้ามอยู่แล้วจริง แต่สิ่งที่พนักงานจะเห็นคือ FK error
 * ภาษาอังกฤษดิบ ๆ ที่อ่านไม่รู้เรื่องและไม่ได้บอกว่าต้องทำอะไรต่อ การเช็คเองก่อน
 * ทำให้ตอบได้ว่า "เมนูนี้เคยถูกสั่งแล้ว ใช้ปิดขายแทน" ซึ่งเป็นคำตอบที่ทำต่อได้
 */
export async function deleteMenuEntity(
  staff: CurrentStaff,
  entity: MenuEntity,
  id: string,
): Promise<MenuAdminResult> {
  if (!canEditMenu(staff.role)) {
    return { ok: false, errorKey: "error.cannot_delete" as const };
  }

  if (!MENU_ENTITIES.includes(entity)) {
    return { ok: false, errorKey: "error.unknown_entity_delete" as const };
  }

  const found = await findEntity(staff.branchId, entity, id);

  if (!found) {
    return { ok: false, errorKey: ENTITY_NOT_FOUND_KEY[entity] };
  }

  const blocked = await reasonCannotDelete(entity, id);

  if (blocked) {
    return { ok: false, errorKey: blocked.errorKey, params: blocked.params };
  }

  await prisma.$transaction(async (tx) => {
    // เขียน log ก่อนลบ เพราะหลังลบแล้วจะอ่านชื่อ/ราคามาเก็บไม่ได้อีก
    await writeAudit(tx, staff, `menu.${entity}.delete`, entity, id, { name: found.name });

    switch (entity) {
      case "category":
        await tx.menuCategory.delete({ where: { id } });
        break;
      case "menuItem":
        // ตารางกลางเป็น Cascade อยู่แล้ว แต่ลบเองก่อนให้ชัดว่าตั้งใจ ไม่ใช่บังเอิญรอด
        await tx.menuItemModifierGroup.deleteMany({ where: { menuItemId: id } });
        await tx.menuItem.delete({ where: { id } });
        break;
      case "modifierGroup":
        await tx.menuItemModifierGroup.deleteMany({ where: { modifierGroupId: id } });
        await tx.modifierGroup.delete({ where: { id } });
        break;
      case "modifier":
        await tx.modifier.delete({ where: { id } });
        break;
    }
  });

  await announceMenuChanged(staff.branchId);

  return { ok: true };
}

/** คืนข้อความเหตุผลถ้าลบไม่ได้ · คืน null ถ้าลบได้ */
async function reasonCannotDelete(entity: MenuEntity, id: string): Promise<MenuFailure | null> {
  switch (entity) {
    case "category": {
      const items = await prisma.menuItem.count({ where: { categoryId: id } });

      return items > 0
        ? {
            errorKey: countKey("error.delete_category_has_items", items),
            params: { count: items },
          }
        : null;
    }

    case "menuItem": {
      const ordered = await prisma.orderItem.count({ where: { menuItemId: id } });

      return ordered > 0
        ? {
            errorKey: countKey("error.delete_item_ordered", ordered),
            params: { count: ordered },
          }
        : null;
    }

    case "modifierGroup": {
      const linked = await prisma.menuItemModifierGroup.count({ where: { modifierGroupId: id } });

      if (linked > 0) {
        return {
          errorKey: countKey("error.delete_group_linked", linked),
          params: { count: linked },
        };
      }

      // ลบกลุ่ม = ตัวเลือกข้างในถูก Cascade ตามไปด้วย จึงต้องเช็คแทนมันทั้งกลุ่ม
      const ordered = await prisma.orderItemModifier.count({
        where: { modifier: { modifierGroupId: id } },
      });

      return ordered > 0 ? { errorKey: "error.delete_group_options_ordered" as const } : null;
    }

    case "modifier": {
      const ordered = await prisma.orderItemModifier.count({ where: { modifierId: id } });

      return ordered > 0
        ? {
            errorKey: countKey("error.delete_modifier_ordered", ordered),
            params: { count: ordered },
          }
        : null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ตัวช่วยภายใน
// ─────────────────────────────────────────────────────────────────────────────

/** อ่านแถวคร่าว ๆ พร้อมยืนยันว่าเป็นของสาขานี้ — คืน null เมื่อไม่ใช่ */
async function findEntity(
  branchId: string,
  entity: MenuEntity,
  id: string,
): Promise<{ name: string; available: boolean } | null> {
  switch (entity) {
    case "category": {
      const row = await prisma.menuCategory.findFirst({
        where: { id, branchId },
        select: { name: true, isAvailable: true },
      });
      return row ? { name: row.name, available: row.isAvailable } : null;
    }
    case "menuItem": {
      const row = await prisma.menuItem.findFirst({
        where: { id, branchId },
        select: { name: true, isAvailable: true },
      });
      return row ? { name: row.name, available: row.isAvailable } : null;
    }
    case "modifierGroup": {
      const row = await prisma.modifierGroup.findFirst({
        where: { id, branchId },
        select: { name: true, isActive: true },
      });
      // กลุ่มใช้คอลัมน์ isActive ไม่ใช่ isAvailable — แปลงให้เป็นคำเดียวกันตรงนี้
      return row ? { name: row.name, available: row.isActive } : null;
    }
    case "modifier": {
      const row = await prisma.modifier.findFirst({
        where: { id, branchId },
        select: { name: true, isAvailable: true },
      });
      return row ? { name: row.name, available: row.isAvailable } : null;
    }
  }
}

/** เพื่อนบ้านที่อยู่ในลิสต์เดียวกัน เรียงตามที่หน้าจอแสดงจริง */
async function loadSiblings(
  branchId: string,
  entity: MenuEntity,
  id: string,
): Promise<{ id: string; sortOrder: number }[] | null> {
  switch (entity) {
    case "category":
      return prisma.menuCategory.findMany({
        where: { branchId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, sortOrder: true },
      });

    case "menuItem": {
      const item = await prisma.menuItem.findFirst({
        where: { id, branchId },
        select: { categoryId: true },
      });

      if (!item) {
        return null;
      }

      // เมนูเรียงกัน "ภายในหมวดของตัวเอง" เท่านั้น การเลื่อนจึงไม่ข้ามหมวด
      return prisma.menuItem.findMany({
        where: { branchId, categoryId: item.categoryId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, sortOrder: true },
      });
    }

    case "modifierGroup":
      return prisma.modifierGroup.findMany({
        where: { branchId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, sortOrder: true },
      });

    case "modifier": {
      const modifier = await prisma.modifier.findFirst({
        where: { id, branchId },
        select: { modifierGroupId: true },
      });

      if (!modifier) {
        return null;
      }

      return prisma.modifier.findMany({
        where: { branchId, modifierGroupId: modifier.modifierGroupId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, sortOrder: true },
      });
    }
  }
}

async function updateSortOrder(
  tx: Prisma.TransactionClient,
  entity: MenuEntity,
  id: string,
  sortOrder: number,
): Promise<void> {
  switch (entity) {
    case "category":
      await tx.menuCategory.update({ where: { id }, data: { sortOrder } });
      return;
    case "menuItem":
      await tx.menuItem.update({ where: { id }, data: { sortOrder } });
      return;
    case "modifierGroup":
      await tx.modifierGroup.update({ where: { id }, data: { sortOrder } });
      return;
    case "modifier":
      await tx.modifier.update({ where: { id }, data: { sortOrder } });
      return;
  }
}

/** ของใหม่ไปต่อท้ายลิสต์เสมอ ไม่ใช่แทรกกลาง — คนเพิ่มเมนูคาดหวังให้มันอยู่ล่างสุด */
async function nextSortOrder(
  tx: Prisma.TransactionClient,
  entity: "category" | "menuItem" | "modifierGroup",
  branchId: string,
  categoryId: string | null,
): Promise<number> {
  const last =
    entity === "category"
      ? await tx.menuCategory.findFirst({
          where: { branchId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        })
      : entity === "menuItem"
        ? await tx.menuItem.findFirst({
            where: { branchId, categoryId: categoryId ?? undefined },
            orderBy: { sortOrder: "desc" },
            select: { sortOrder: true },
          })
        : await tx.modifierGroup.findFirst({
            where: { branchId },
            orderBy: { sortOrder: "desc" },
            select: { sortOrder: true },
          });

  return (last?.sortOrder ?? 0) + 1;
}

/**
 * ลิงก์รูปที่ใช้ได้จริงกับ `next/image`
 *
 * ยอมรับแค่ https:// (โดเมนภายนอก) หรือขึ้นต้นด้วย / (ไฟล์ใน public/)
 * — http:// ธรรมดาถูกตัดทิ้งเพราะหน้าลูกค้าเสิร์ฟผ่าน https แล้วเบราว์เซอร์จะบล็อก
 * mixed content ทำให้รูปหายเงียบ ๆ โดยไม่มี error ให้เห็นบนหน้าจอ
 */
function isUsableImageUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("/");
}

/** เขียน AuditLog — ต้องเรียกในทรานแซกชันเดียวกับการแก้เสมอ */
async function writeAudit(
  tx: Prisma.TransactionClient,
  staff: CurrentStaff,
  action: string,
  entity: MenuEntity,
  entityId: string,
  metadata: Prisma.InputJsonValue,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      branchId: staff.branchId,
      staffId: staff.id,
      action,
      entityType: entity,
      entityId,
      metadata,
    },
  });
}

/**
 * บอกทุกจอว่าเมนูเปลี่ยน — เรียกหลัง commit เท่านั้น
 *
 * `tableId: null` เพราะเป็นเรื่องระดับสาขา และ event ชนิดนี้อยู่ในรายชื่อ
 * `CUSTOMER_BROADCAST_EVENTS` จึงถูกส่งถึงมือถือลูกค้าทุกโต๊ะด้วย
 * (event อื่นที่ tableId เป็น null จะไม่ถึงลูกค้า — ดู lib/realtime-events.ts)
 */
async function announceMenuChanged(branchId: string): Promise<void> {
  await publishRealtimeEvent({
    v: REALTIME_EVENT_VERSION,
    type: "menu.changed",
    branchId,
    tableId: null,
    at: Date.now(),
  });
}
