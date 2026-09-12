import Link from "next/link";
import { redirect } from "next/navigation";

import { intlLocale } from "@/lib/i18n/locales";
import { formatMoney } from "@/lib/money";
import { canAccessScreen, canViewShiftHistory } from "@/lib/rbac";
import { getT } from "@/lib/server/locale";
import { listShifts } from "@/lib/server/shift";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * ประวัติกะ (spec §14 "Managers should be able to review cash discrepancies")
 *
 * คอลัมน์ที่ผู้จัดการกวาดตาหาคือ **ส่วนต่าง** ไม่ใช่ยอดขาย จึงอยู่ขวาสุดและ
 * แถวที่ไม่เป็นศูนย์ถูกเน้น — ยอดขายดูที่หน้า "สรุปวันนี้" ได้อยู่แล้ว
 *
 * ไม่ได้เพิ่มเป็นโมดูลที่เจ็ดในแถบเมนู: แถบล่างของจอแคบมีหกช่องแล้ว และที่ 390px
 * เหลือช่องละ ~55px (CLAUDE.md เตือนไว้) — ทางเข้าคือลิงก์จากหน้า "สรุปวันนี้"
 * ซึ่งคนที่เห็นเป็นชุดเดียวกับ `canViewShiftHistory` พอดี
 */
export default async function AdminShiftsPage() {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  // ตำแหน่งที่เข้าไม่ได้ถูกพากลับไปหน้าที่ทำงานได้ ไม่ใช่ขึ้นว่า "ไม่มีสิทธิ์"
  // (กติกาเดียวกับหน้าสรุปวันนี้ของก้อนก่อน)
  if (!canViewShiftHistory(staff.role)) {
    redirect("/admin/menu");
  }

  const { t, locale } = await getT();
  const currency = staff.branch.currency;
  const shifts = await listShifts(staff.branchId);

  const time = (value: Date) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: staff.branch.timezone,
    }).format(value);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto p-4 lg:p-8">
      <h1 className="display mb-4 text-[26px]">{t("admin.shifts.title")}</h1>

      {shifts.length === 0 ? (
        <p className="panel p-6">{t("admin.shifts.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shifts.map((shift) => (
            <li key={shift.id}>
              <Link
                href={`/admin/shifts/${shift.id}`}
                className="panel flex flex-wrap items-baseline justify-between gap-3 p-4 transition-colors hover:bg-[var(--color-accent-100)]"
              >
                <span className="display text-[16px]">{time(shift.openedAt)}</span>
                <span className="kicker">
                  {shift.status === "OPEN"
                    ? t("shift.status.OPEN")
                    : t("admin.shifts.closedBy", {
                        staff: shift.closedByStaff?.name ?? t("shift.unknownStaff"),
                      })}
                </span>
                <span>{formatMoney(shift.salesTotal ?? 0, currency)}</span>
                <span className={shift.cashDifference ? "display text-[16px]" : "kicker"}>
                  {t("admin.shifts.difference", {
                    amount: formatMoney(shift.cashDifference ?? 0, currency),
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
