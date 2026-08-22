import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveRefresh } from "@/components/live-refresh";
import { formatMoney } from "@/lib/money";
import { canAccessScreen, canEditMenu } from "@/lib/rbac";
import { getMenuTree } from "@/lib/server/menu-admin";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { AvailabilityToggle, MoveButtons } from "../_components/menu-forms";

/**
 * ลิสต์เมนูทั้งร้าน (โมดูล 04)
 *
 * ── ทำไมของหมดกดได้จากลิสต์เลย ไม่ต้องเข้าหน้าแก้ ─────────────────────
 * เพราะ "ของหมด" เป็นงานกลางกะที่ต้องกดเร็วที่สุดในทั้งโมดูล และเป็นสิ่งเดียวที่
 * พนักงานหน้าร้าน/ครัวทำได้ ถ้าต้องเข้าหน้าฟอร์มเต็มเพื่อพลิกบูลีนหนึ่งช่อง
 * สุดท้ายจะไม่มีใครกด แล้วลูกค้าจะสั่งของที่ไม่มี
 *
 * ส่วนการแก้ราคา/สร้างเมนูอยู่ในหน้าฟอร์มแยก เพราะเป็นงานที่ทำตอนร้านว่าง
 * และต้องเห็นทุกช่องพร้อมกันก่อนกดบันทึก
 *
 * แสดง **ของที่ปิดขายอยู่ด้วย** (ต่างจากหน้าลูกค้าที่กรองทิ้งตั้งแต่ใน query)
 * ไม่งั้นจะเปิดกลับไม่ได้เลย — นี่คือเหตุผลที่ต้องมี lib/server/menu-admin.ts แยก
 */
export default async function AdminMenuPage() {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  const categories = await getMenuTree(staff.branchId);
  const editable = canEditMenu(staff.role);
  const currency = staff.branch.currency;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[58px] flex-none flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
        <div className="flex items-baseline gap-3">
          <span className="display text-[19px]">เมนูและสินค้า</span>
          <span className="kicker">{categories.length} หมวด</span>
        </div>

        <div className="flex items-center gap-3">
          {/* คนอื่นแก้เมนูอยู่พร้อมกันได้ (ครัวกดของหมดจากอีกเครื่อง) */}
          <LiveRefresh src="/api/realtime" className="text-[var(--color-accent-700)]" />
          {editable ? (
            <Link href="/admin/menu/category/new" className="btn btn-secondary h-10 text-[14px]">
              + หมวด
            </Link>
          ) : null}
          {editable && categories.length > 0 ? (
            <Link href="/admin/menu/item/new" className="btn btn-primary h-10 text-[14px]">
              + เมนู
            </Link>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        {categories.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="display text-[24px]">ยังไม่มีหมวดเมนู</p>
            <p className="text-[var(--color-neutral-700)]">
              เมนูทุกรายการต้องอยู่ในหมวด จึงต้องสร้างหมวดก่อน
            </p>
            {editable ? (
              <Link href="/admin/menu/category/new" className="btn btn-primary mt-2 h-11">
                สร้างหมวดแรก
              </Link>
            ) : (
              <p className="kicker">ตำแหน่งของคุณสร้างหมวดไม่ได้ — เรียกผู้จัดการ</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {categories.map((category) => (
              <section key={category.id} className="panel">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3">
                  <div className="flex min-w-0 items-baseline gap-3">
                    <span className="display text-[17px]">{category.name}</span>
                    <span className="kicker">{category.items.length} รายการ</span>
                    {category.isAvailable ? null : (
                      <span className="tag tag-neutral">ปิดทั้งหมวด</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <AvailabilityToggle
                      entity="category"
                      id={category.id}
                      available={category.isAvailable}
                    />
                    {editable ? (
                      <>
                        <MoveButtons entity="category" id={category.id} />
                        <Link
                          href={`/admin/menu/category/${category.id}`}
                          className="btn btn-secondary h-9 px-3 text-[13px]"
                        >
                          แก้
                        </Link>
                      </>
                    ) : null}
                  </div>
                </header>

                {category.items.length === 0 ? (
                  <p className="kicker px-4 py-4">ยังไม่มีเมนูในหมวดนี้</p>
                ) : (
                  <ul className="flex flex-col">
                    {category.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-divider)] px-4 py-3 last:border-b-0"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="display text-[15px]">{item.name}</span>
                          <span className="kicker">
                            {/* สถานีครัวต้องอ่านออกจากลิสต์ เพราะเมนูที่ตั้งสถานีผิด
                                จะไปค้างรออยู่บนจอครัวที่ไม่มีใครดู */}
                            {item.station?.name ?? "ไม่ผ่านครัว"}
                            {item._count.modifierGroups > 0
                              ? ` · ${item._count.modifierGroups} กลุ่มตัวเลือก`
                              : ""}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="display w-24 text-right text-[15px] tabular-nums">
                            {formatMoney(item.basePrice, currency)}
                          </span>

                          <AvailabilityToggle
                            entity="menuItem"
                            id={item.id}
                            available={item.isAvailable}
                          />

                          {editable ? (
                            <>
                              <MoveButtons entity="menuItem" id={item.id} />
                              <Link
                                href={`/admin/menu/item/${item.id}`}
                                className="btn btn-secondary h-9 px-3 text-[13px]"
                              >
                                แก้
                              </Link>
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
