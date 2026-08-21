import "server-only";

import { prisma } from "@/lib/server/db";

/**
 * การอ่านเมนูฝั่งลูกค้า (บทที่ 6)
 *
 * กฎสองข้อของไฟล์นี้:
 *   1. กรอง isAvailable = true "ทุกชั้น" — หมวดปิด, เมนูของหมด, ตัวเลือกที่หมด
 *      ต้องไม่โผล่บนมือถือลูกค้าเลย ไม่ใช่ให้กดแล้วค่อยเด้ง error
 *   2. ดึงครั้งเดียวจบ ไม่ยิงทีละเมนูในลูป (N+1) เพราะลูกค้าอยู่บนเน็ตมือถือ
 *      ที่อาจอ่อนมาก ทุก roundtrip คือเวลารอที่เห็นได้ด้วยตา
 */

export type CustomerMenu = Awaited<ReturnType<typeof getCustomerMenu>>;
export type CustomerMenuItem = Awaited<ReturnType<typeof getCustomerMenuItem>>;

/**
 * เมนูทั้งร้านสำหรับหน้าแรกของลูกค้า — หมวด → รายการ
 *
 * ตั้งใจไม่ดึง ModifierGroup/Modifier มาที่นี่ เพราะหน้ารวมไม่ได้ใช้ ดึงมาก็เปลือง
 * แต่ต้องรู้ว่าเมนูไหน "มีตัวเลือกให้เลือก" เพื่อจะได้พาไปหน้ารายละเอียดแทนการ
 * ใส่ตะกร้าทันที จึงดึงมาแค่ take: 1 พอให้รู้ว่ามีหรือไม่มี
 */
export async function getCustomerMenu(branchId: string) {
  const categories = await prisma.menuCategory.findMany({
    where: { branchId, isAvailable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      items: {
        where: { isAvailable: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          modifierGroups: {
            where: { modifierGroup: { isActive: true } },
            select: { modifierGroupId: true },
            take: 1,
          },
        },
      },
    },
  });

  // หมวดที่เมนูข้างในหมดทั้งหมวดไม่ต้องแสดงหัวข้อค้างไว้ให้ลูกค้างง
  return categories
    .filter((category) => category.items.length > 0)
    .map((category) => ({
      ...category,
      items: category.items.map(({ modifierGroups, ...item }) => ({
        ...item,
        hasOptions: modifierGroups.length > 0,
      })),
    }));
}

/**
 * เมนูหนึ่งรายการพร้อมกลุ่มตัวเลือกครบชั้น สำหรับหน้ารายละเอียด/หน้าเลือกตัวเลือก
 *
 * บังคับส่ง branchId เข้ามาด้วยเสมอ แม้จะรู้ id ของเมนูอยู่แล้ว เพื่อกันไม่ให้
 * ลูกค้าที่โต๊ะสาขา A ยิง id เมนูของสาขา B เข้ามาสั่งได้ (multi-tenant, CLAUDE.md หัวข้อ 4)
 */
export async function getCustomerMenuItem(branchId: string, menuItemId: string) {
  return prisma.menuItem.findFirst({
    where: { id: menuItemId, branchId, isAvailable: true, category: { isAvailable: true } },
    include: {
      category: { select: { id: true, name: true } },
      modifierGroups: {
        where: { modifierGroup: { isActive: true } },
        orderBy: { sortOrder: "asc" },
        include: {
          modifierGroup: {
            include: {
              modifiers: {
                where: { isAvailable: true },
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
              },
            },
          },
        },
      },
    },
  });
}
