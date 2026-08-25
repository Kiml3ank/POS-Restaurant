import Link from "next/link";
import { redirect } from "next/navigation";

import { STAFF_ROLE_LABEL, canAccessScreen, canManageStaff } from "@/lib/rbac";
import { listStaff } from "@/lib/server/staff-admin";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * รายชื่อพนักงานของสาขา (บทที่ 13b · spec §12)
 *
 * ── ทำไมหน้านี้ไม่ให้ทุกตำแหน่งเข้า ต่างจากหน้าอื่นในจอหลังร้าน ─────────
 * จอหลังร้านเปิดให้ทุกตำแหน่งโดยตั้งใจ (พ่อครัวต้องกด "ของหมด" ได้กลางกะ)
 * แต่หน้านี้เผยรายชื่อทั้งสาขาพร้อมตำแหน่งและเวลาเข้าใช้งานล่าสุด ซึ่งเป็นข้อมูล
 * ที่ใช้วางแผนโกงได้พอ ๆ กับที่ใช้จับโกง — `canManageStaff` = OWNER/MANAGER
 *
 * "เครื่องที่ล็อกอินอยู่" เป็นคอลัมน์บนลิสต์ ไม่ใช่ต้องกดเข้าไปดูทีละคน
 * เพราะคำถามที่ผู้จัดการถามจริงคือ "ตอนนี้ใครเปิดเครื่องค้างไว้บ้าง" ซึ่งเป็น
 * คำถามระดับสาขา ไม่ใช่ระดับคน
 */
export default async function StaffListPage() {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  if (!canManageStaff(staff.role)) {
    return (
      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
          <span className="display text-[19px]">พนักงาน</span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
          <div className="panel mx-auto mt-8 flex max-w-[520px] flex-col gap-2 p-6">
            <span className="display text-[20px]">ดูหน้านี้ไม่ได้</span>
            <p className="text-[var(--color-neutral-700)]">
              เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่จัดการบัญชีพนักงานได้
            </p>
          </div>
        </div>
      </main>
    );
  }

  const rows = await listStaff(staff.branchId);
  const activeCount = rows.filter((row) => row.isActive).length;
  const loggedIn = rows.reduce((sum, row) => sum + row.activeSessions, 0);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
        <div className="flex items-baseline gap-3">
          <span className="display text-[19px]">พนักงาน</span>
          <span className="kicker">
            ใช้งานอยู่ {activeCount} คน · ล็อกอินค้างอยู่ {loggedIn} เครื่อง
          </span>
        </div>

        <Link href="/admin/staff/new" className="btn btn-primary h-10 text-[14px]">
          เพิ่มพนักงาน
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        <ul className="panel mx-auto flex w-full max-w-[900px] flex-col">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-[var(--color-divider)] last:border-b-0">
              <Link
                href={`/admin/staff/${row.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-accent-100)]"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="display text-[15px]">
                    {row.code} · {row.name}
                  </span>
                  <span className="kicker">
                    {STAFF_ROLE_LABEL[row.role]}
                    {row.lastLoginAt
                      ? ` · เข้าล่าสุด ${formatDateTime(row.lastLoginAt, staff.branch.timezone)}`
                      : " · ยังไม่เคยเข้าใช้งาน"}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {row.activeSessions > 0 ? (
                    <span className="tag tag-solid">{row.activeSessions} เครื่อง</span>
                  ) : null}
                  <span className={row.isActive ? "tag tag-neutral" : "tag"}>
                    {row.isActive ? "ใช้งานอยู่" : "ปิดใช้งาน"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

function formatDateTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}
