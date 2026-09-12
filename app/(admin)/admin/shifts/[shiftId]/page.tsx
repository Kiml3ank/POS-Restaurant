import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ShiftSummary } from "@/components/shift-summary";
import { canAccessScreen, canViewShiftHistory } from "@/lib/rbac";
import { getT } from "@/lib/server/locale";
import { getShift } from "@/lib/server/shift";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * ใบสรุปกะใบเดียวกับที่จอ POS แสดง — ต่างกันแค่ด่านสิทธิ์และลิงก์กลับ
 *
 * ตัวใบใช้ `<ShiftSummary />` ตัวเดิม **ห้ามเขียนใบใหม่** (ท่าเดียวกับ
 * `receipt-document.tsx` ของบทที่ 12) — สองชุดแปลว่าวันหนึ่งตัวเลขบนกระดาษ
 * ของแคชเชียร์กับตัวเลขบนจอผู้จัดการจะไม่ตรงกัน
 */
export default async function AdminShiftSummaryPage({
  params,
}: {
  params: Promise<{ shiftId: string }>;
}) {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  if (!canViewShiftHistory(staff.role)) {
    redirect("/admin/menu");
  }

  const { shiftId } = await params;
  const shift = await getShift(staff.branchId, shiftId);

  if (!shift) {
    notFound();
  }

  const { t, locale } = await getT();

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto p-4 lg:p-8">
      {/* ลิงก์ต้องไม่ติดไปบนกระดาษ — กฎเดียวกับใบเสร็จบทที่ 12 */}
      <div data-print-hide className="mb-4">
        <Link href="/admin/shifts" className="kicker">
          ‹ {t("admin.shifts.title")}
        </Link>
      </div>

      <div className="max-w-md">
        <ShiftSummary
          shift={shift}
          currency={shift.branch.currency}
          timezone={shift.branch.timezone}
          locale={locale}
          t={t}
        />
      </div>
    </main>
  );
}
