import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveRefresh } from "@/components/live-refresh";
import { intlLocale } from "@/lib/i18n/locales";
import { countKey } from "@/lib/i18n/translate";
import { formatMoney } from "@/lib/money";
import { canManageShift } from "@/lib/rbac";
import { getT } from "@/lib/server/locale";
import { getCashOutsideShift, getOpenShift, getShiftReport } from "@/lib/server/shift";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { CloseShiftForm, OpenShiftForm } from "./_components/shift-forms";

/**
 * โมดูล 06 — กะการขาย (บทที่ 15)
 *
 * **จอเดียวสองโหมด** เหมือน `/pos/table/[id]/bill` ของบทที่ 11:
 * ไม่มีกะเปิด → ฟอร์มเปิดกะ · มีกะเปิด → X report สด + ฟอร์มปิดกะ
 * แยกเป็นสอง route แล้วพนักงานจะต้องจำว่าตอนนี้ต้องกดหน้าไหน ซึ่งเป็นสิ่งที่
 * ระบบตอบเองได้จากสถานะในฐาน
 */
export default async function PosShiftPage() {
  const staff = await getCurrentStaff("pos");

  if (!staff || !canManageShift(staff.role)) {
    redirect("/pos/login");
  }

  const { t, locale } = await getT();
  const currency = staff.branch.currency;
  const shift = await getOpenShift(staff.branchId);
  const report = shift ? await getShiftReport(staff.branchId, shift.id) : null;
  const outside = await getCashOutsideShift(staff.branchId);

  const time = (value: Date) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: staff.branch.timezone,
    }).format(value);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto p-4 lg:p-8">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h1 className="display text-[26px]">{t("pos.shift.title")}</h1>
        <LiveRefresh src="/api/realtime" className="text-[var(--color-accent-700)]" />
      </div>

      {report === null ? (
        <div className="flex max-w-xl flex-col gap-4">
          <p className="kicker">{t("pos.shift.noOpenHint")}</p>

          {outside.count > 0 ? (
            <div className="alert flex flex-col gap-1">
              <p>
                {t("pos.shift.outsideCash", {
                  amount: formatMoney(outside.total, currency),
                  bills: t(countKey("shift.bills", outside.count), { count: outside.count }),
                })}
              </p>
              {outside.firstAt && outside.lastAt ? (
                <p className="kicker">
                  {t("pos.shift.outsideCashRange", {
                    from: time(outside.firstAt),
                    to: time(outside.lastAt),
                  })}
                </p>
              ) : null}
              <p className="kicker">{t("pos.shift.outsideCashWhy")}</p>
            </div>
          ) : null}

          <OpenShiftForm />
        </div>
      ) : (
        <div className="flex max-w-xl flex-col gap-4">
          <div className="panel flex flex-col gap-3 p-6">
            <div className="flex flex-col gap-0.5">
              <p className="kicker">{t("pos.shift.xTitle")}</p>
              <p className="text-[14px] text-[var(--color-neutral-700)]">
                {t("pos.shift.openedAt", {
                  time: time(report.shift.openedAt),
                  staff: staff.name,
                })}
              </p>
            </div>

            <div className="rule" />

            <dl className="flex flex-col gap-2 text-[15px]">
              <Line
                label={t("shift.field.salesTotal")}
                value={formatMoney(report.salesTotal, currency)}
              />
              <Line
                label={t("shift.field.billCount")}
                value={t(countKey("shift.bills", report.billCount), {
                  count: report.billCount,
                })}
              />
              <Line
                label={t("paymentMethod.CASH")}
                value={formatMoney(report.cashTotal, currency)}
              />
              <Line
                label={t("shift.field.openingFloat")}
                value={formatMoney(report.shift.openingFloat, currency)}
              />
              <Line
                label={t("shift.field.expectedCash")}
                value={formatMoney(report.expectedCash, currency)}
                strong
              />
            </dl>

            <p className="kicker">{t("pos.shift.xHint")}</p>
          </div>

          <CloseShiftForm
            shiftId={report.shift.id}
            expectedLabel={formatMoney(report.expectedCash, currency)}
          />
        </div>
      )}

      <Link href="/pos" className="kicker mt-6">
        ‹ {t("pos.shift.back")}
      </Link>
    </main>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "display" : undefined}>{label}</dt>
      <dd className={strong ? "display text-[18px]" : "display"}>{value}</dd>
    </div>
  );
}
