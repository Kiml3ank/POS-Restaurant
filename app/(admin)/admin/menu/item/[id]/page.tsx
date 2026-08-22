import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { canAccessScreen, canEditMenu } from "@/lib/rbac";
import { getMenuItemForEdit } from "@/lib/server/menu-admin";
import { getCurrentStaff } from "@/lib/server/staff-session";

import {
  DeleteButton,
  MenuItemForm,
  MenuItemGroupsForm,
} from "../../../_components/menu-forms";

/**
 * ฟอร์มเมนูหนึ่งรายการ — route เดียวทั้งสร้างใหม่และแก้ของเดิม (`[id] === "new"`)
 *
 * แบ่งเป็นสามกล่องที่บันทึกแยกกันโดยตั้งใจ:
 *   1. ข้อมูลเมนู (ชื่อ/ราคา/หมวด/สถานี/รูป)
 *   2. กลุ่มตัวเลือกที่ผูกอยู่ — ต้องมีเมนูใน DB ก่อนถึงจะผูกได้ จึงโผล่เฉพาะตอนแก้
 *   3. ลบถาวร — แยกออกมาให้ห่างจากปุ่มบันทึก เพราะกดพลาดแล้วย้อนไม่ได้
 */
export default async function AdminMenuItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  if (!canEditMenu(staff.role)) {
    redirect("/admin/menu");
  }

  const { id } = await params;
  const isNew = id === "new";
  const data = await getMenuItemForEdit(staff.branchId, isNew ? null : id);

  if (!data) {
    notFound();
  }

  const { item, categories, stations, groups } = data;

  if (categories.length === 0) {
    redirect("/admin/menu/category/new");
  }

  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <span className="display text-[22px]">{isNew ? "เพิ่มเมนู" : "แก้เมนู"}</span>
          <Link href="/admin/menu" className="btn btn-ghost h-10 text-[14px]">
            ยกเลิก
          </Link>
        </div>

        <div className="panel p-4 sm:p-5">
          <MenuItemForm
            item={
              item
                ? {
                    id: item.id,
                    name: item.name,
                    description: item.description,
                    categoryId: item.categoryId,
                    stationId: item.stationId,
                    imageUrl: item.imageUrl,
                    basePrice: item.basePrice,
                  }
                : null
            }
            categories={categories}
            stations={stations}
            currency={staff.branch.currency}
          />
        </div>

        {item ? (
          <>
            <div className="panel flex flex-col gap-3 p-4 sm:p-5">
              <span className="kicker">กลุ่มตัวเลือกของเมนูนี้</span>
              <MenuItemGroupsForm
                menuItemId={item.id}
                groups={groups}
                selectedIds={item.modifierGroups.map((link) => link.modifierGroupId)}
              />
            </div>

            <div className="panel flex flex-col gap-3 p-4 sm:p-5">
              <span className="kicker">ลบเมนูนี้</span>
              <p className="text-[14px] text-[var(--color-neutral-700)]">
                เมนูที่เคยถูกสั่งไปแล้วลบไม่ได้ เพราะบิลเก่าอ้างถึงอยู่ —
                ใช้ปุ่ม “ของหมด” ที่หน้าลิสต์แทนเพื่อเลิกขาย
              </p>
              <DeleteButton entity="menuItem" id={item.id} name={item.name} />
            </div>
          </>
        ) : (
          <p className="kicker">
            บันทึกเมนูก่อน แล้วจะผูกกลุ่มตัวเลือก (ขนาด/ความเผ็ด/ท็อปปิ้ง) ได้
          </p>
        )}
      </div>
    </main>
  );
}
