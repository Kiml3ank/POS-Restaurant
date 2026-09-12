import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ShiftSummary } from "@/components/shift-summary";
import { canManageShift } from "@/lib/rbac";
import { getT } from "@/lib/server/locale";
import { getShift } from "@/lib/server/shift";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * ใบสรุปกะที่ปิดแล้ว (Z report)
 *
 * ไม่มีปุ่มพิมพ์ของตัวเอง — `components/receipt-print-button.tsx` ใช้ไม่ได้เพราะ
 * มันนับการพิมพ์ลง `AuditLog` ของ **ใบเสร็จ** ใบสรุปกะพิมพ์กี่ครั้งก็ได้ ไม่ต้องนับ
 * **ห้ามก๊อปปุ่มนั้นมาแก้** เพราะจะได้ตัวนับที่ชี้ผิดเอกสาร — ให้กด Ctrl+P เอง
 * (CSS พิมพ์ 80mm ของบทที่ 12 ทำงานให้อยู่แล้วผ่านคลาส `receipt-doc`)
 */
export default async function PosShiftSummaryPage({
  params,
}: {
  params: Promise<{ shiftId: string }>;
}) {
  const staff = await getCurrentStaff("pos");

  if (!staff || !canManageShift(staff.role)) {
    redirect("/pos/login");
  }

  const { shiftId } = await params;
  const shift = await getShift(staff.branchId, shiftId);

  if (!shift) {
    notFound();
  }

  const { t, locale } = await getT();

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto p-4 lg:p-8">
      {/* ปุ่มกับลิงก์ต้องไม่ติดไปบนกระดาษ — กฎเดียวกับใบเสร็จบทที่ 12 */}
      <div data-print-hide className="mb-4 flex items-center justify-between gap-4">
        <Link href="/pos/shift" className="kicker">
          ‹ {t("pos.shift.title")}
        </Link>
        <span className="kicker">{t("pos.shift.print")}: Ctrl + P</span>
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
