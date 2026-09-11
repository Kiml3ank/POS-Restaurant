import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { canAccessScreen, canEditMenu } from "@/lib/rbac";
import { prisma } from "@/lib/server/db";
import { getT } from "@/lib/server/locale";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { CategoryForm, DeleteButton } from "../../../_components/menu-forms";

/**
 * ฟอร์มหมวดเมนู — ใช้ route เดียวทั้ง "สร้างใหม่" และ "แก้ของเดิม"
 *
 * `[id]` เป็นคำว่า `new` = สร้างใหม่ · เป็น cuid = แก้ของเดิม
 * ทำแบบนี้แทนการมีโฟลเดอร์ `new/` แยก เพราะสองหน้านั้นต่างกันแค่ค่าเริ่มต้นในฟอร์ม
 * กับปุ่มลบ — แยกไฟล์แล้วจะได้ JSX เกือบเหมือนกันสองชุดที่ต้องแก้พร้อมกันตลอดไป
 */
export default async function AdminCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, tc } = await getT();
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  // ทุกอย่างในหน้านี้เป็นการ "แก้" ทั้งหมด ตำแหน่งที่แก้ไม่ได้จึงไม่ควรมาถึงตรงนี้
  // (ลิงก์ถูกซ่อนอยู่แล้ว แต่ URL พิมพ์เองได้ — ด่านจริงอยู่ใน Server Action อีกชั้น)
  if (!canEditMenu(staff.role)) {
    redirect("/admin/menu");
  }

  const { id } = await params;
  const isNew = id === "new";

  const category = isNew
    ? null
    : await prisma.menuCategory.findFirst({
        where: { id, branchId: staff.branchId },
        include: { _count: { select: { items: true } } },
      });

  if (!isNew && !category) {
    notFound();
  }

  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <span className="display text-[22px]">
            {t(isNew ? "admin.category.addTitle" : "admin.category.editTitle")}
          </span>
          <Link href="/admin/menu" className="btn btn-ghost h-10 text-[14px]">
            {t("common.cancel")}
          </Link>
        </div>

        <div className="panel p-4 sm:p-5">
          <CategoryForm category={category ? { id: category.id, name: category.name } : null} />
        </div>

        {category ? (
          <div className="panel flex flex-col gap-3 p-4 sm:p-5">
            <span className="kicker">{t("admin.category.deleteTitle")}</span>
            <p className="text-[14px] text-[var(--color-neutral-700)]">
              {category._count.items > 0
                ? tc("admin.category.hasItems", category._count.items)
                : t("admin.category.canDelete")}
            </p>
            <DeleteButton entity="category" id={category.id} name={category.name} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
