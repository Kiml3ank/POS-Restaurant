import Link from "next/link";
import { redirect } from "next/navigation";

import { formatMoneyDelta } from "@/lib/money";
import { canAccessScreen, canEditMenu } from "@/lib/rbac";
import { getModifierGroups } from "@/lib/server/menu-admin";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { AvailabilityToggle, MoveButtons } from "../_components/menu-forms";

/**
 * ลิสต์กลุ่มตัวเลือก (โมดูล 04)
 *
 * กลุ่มเดียวใช้ได้หลายเมนู (many-to-many) หน้านี้จึงบอก "ผูกอยู่กี่เมนู" เสมอ —
 * เพราะการแก้กลุ่มหนึ่งครั้งกระทบทุกเมนูที่ใช้มัน ซึ่งเป็นเรื่องที่คนกดต้องรู้ก่อน
 * ไม่ใช่รู้ตอนลูกค้าโทรมาบ่นว่าเมนูอื่นเปลี่ยนไปด้วย
 */
export default async function AdminModifiersPage() {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  const groups = await getModifierGroups(staff.branchId);
  const editable = canEditMenu(staff.role);
  const currency = staff.branch.currency;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[58px] flex-none flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
        <div className="flex items-baseline gap-3">
          <span className="display text-[19px]">กลุ่มตัวเลือก</span>
          <span className="kicker">{groups.length} กลุ่ม</span>
        </div>

        {editable ? (
          <Link href="/admin/modifiers/new" className="btn btn-primary h-10 text-[14px]">
            + กลุ่มตัวเลือก
          </Link>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="display text-[24px]">ยังไม่มีกลุ่มตัวเลือก</p>
            <p className="max-w-[420px] text-[var(--color-neutral-700)]">
              กลุ่มตัวเลือกคือ “ขนาด” “ระดับความเผ็ด” “ท็อปปิ้ง” —
              สร้างครั้งเดียวแล้วผูกกับเมนูไหนก็ได้หลายเมนู
            </p>
            {editable ? (
              <Link href="/admin/modifiers/new" className="btn btn-primary mt-2 h-11">
                สร้างกลุ่มแรก
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <section key={group.id} className="panel">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                    <span className="display text-[17px]">{group.name}</span>
                    {group.required ? <span className="tag tag-accent">บังคับเลือก</span> : null}
                    <span className="kicker">
                      เลือก {group.minSelect}–{group.maxSelect} · ใช้อยู่ {group._count.menuItems}{" "}
                      เมนู
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <AvailabilityToggle
                      entity="modifierGroup"
                      id={group.id}
                      available={group.isActive}
                    />
                    {editable ? (
                      <>
                        <MoveButtons entity="modifierGroup" id={group.id} />
                        <Link
                          href={`/admin/modifiers/${group.id}`}
                          className="btn btn-secondary h-9 px-3 text-[13px]"
                        >
                          แก้
                        </Link>
                      </>
                    ) : null}
                  </div>
                </header>

                <ul className="flex flex-col">
                  {group.modifiers.map((modifier) => (
                    <li
                      key={modifier.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-divider)] px-4 py-2.5 last:border-b-0"
                    >
                      <span className="text-[15px]">{modifier.name}</span>

                      <div className="flex items-center gap-2">
                        <span className="w-20 text-right text-[14px] tabular-nums">
                          {/* ส่วนต่าง 0 ไม่ต้องเขียนอะไรเลย — "+฿0.00" คือ noise
                              ที่ทำให้ตัวเลือกที่มีราคาจริงกลืนไปกับตัวที่ไม่มี */}
                          {formatMoneyDelta(modifier.priceDelta, currency)}
                        </span>
                        <AvailabilityToggle
                          entity="modifier"
                          id={modifier.id}
                          available={modifier.isAvailable}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
