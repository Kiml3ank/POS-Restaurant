import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { canAccessScreen, canEditMenu } from "@/lib/rbac";
import { getModifierGroup } from "@/lib/server/menu-admin";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { DeleteButton, ModifierGroupForm } from "../../_components/menu-forms";

/**
 * ฟอร์มกลุ่มตัวเลือก — route เดียวทั้งสร้างใหม่และแก้ของเดิม (`[id] === "new"`)
 *
 * ตัวเลือกย่อยแก้อยู่ในฟอร์มเดียวกับกลุ่ม ไม่แยกหน้า เพราะกฎการเลือก
 * (บังคับไหม · ขั้นต่ำ/สูงสุดกี่ชิ้น) ตรวจสอบกันเองกับ "จำนวนตัวเลือกที่มี" —
 * เช่น ขั้นต่ำ 2 แต่มีตัวเลือกเดียว = ลูกค้าจะกดใส่ตะกร้าไม่ผ่านตลอดกาล
 * ถ้าแยกสองหน้า คนกดจะบันทึกกฎก่อนแล้วเพิ่มตัวเลือกทีหลัง ซึ่งมีช่วงที่ผิดกฎอยู่จริง
 */
export default async function AdminModifierGroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  if (!canEditMenu(staff.role)) {
    redirect("/admin/modifiers");
  }

  const { id } = await params;
  const isNew = id === "new";
  const group = isNew ? null : await getModifierGroup(staff.branchId, id);

  if (!isNew && !group) {
    notFound();
  }

  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <span className="display text-[22px]">
            {isNew ? "สร้างกลุ่มตัวเลือก" : "แก้กลุ่มตัวเลือก"}
          </span>
          <Link href="/admin/modifiers" className="btn btn-ghost h-10 text-[14px]">
            ยกเลิก
          </Link>
        </div>

        <div className="panel p-4 sm:p-5">
          <ModifierGroupForm group={group} currency={staff.branch.currency} />
        </div>

        {group ? (
          <div className="panel flex flex-col gap-3 p-4 sm:p-5">
            <span className="kicker">ลบกลุ่มนี้</span>
            <p className="text-[14px] text-[var(--color-neutral-700)]">
              ลบได้เฉพาะกลุ่มที่ไม่ได้ผูกกับเมนูไหนแล้ว และตัวเลือกข้างในยังไม่เคยถูกสั่ง —
              ถ้าลบไม่ได้ให้กด “ปิดใช้งาน” ที่หน้าลิสต์แทน
            </p>
            <DeleteButton entity="modifierGroup" id={group.id} name={group.name} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
