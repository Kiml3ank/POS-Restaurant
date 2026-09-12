import { redirect } from "next/navigation";

import { formatMoney } from "@/lib/money";
import { paymentMethodKey } from "@/lib/payment-method";
import { canAccessScreen, canViewReports } from "@/lib/rbac";
import { MAX_REPORT_DAYS, resolveReportRange } from "@/lib/report-range";
import { getT } from "@/lib/server/locale";
import { getSalesReport } from "@/lib/server/reports";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { RangePicker } from "./_components/range-picker";

/**
 * รายงานยอดขายย้อนหลัง (spec §18)
 *
 * หน้าเดียวสี่ส่วนเรียงลงมา ไม่ใช่สี่หน้า — ผู้จัดการต้องกวาดตาทีเดียวจบแล้วกดส่งออก
 *
 * **ไม่ใช้ไลบรารีกราฟ** แถบสัดส่วนวาดด้วย `div` กว้างเป็น % ซึ่งพอสำหรับคำถาม
 * "วันไหน/ชั่วโมงไหนขายดี" และไม่ต้องแบก dependency ที่ต้องดูแลธีม/ภาษา/ขนาดจอเอง
 */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  // ตำแหน่งที่เข้าไม่ได้ถูกพากลับไปหน้าที่ทำงานได้ (กติกาเดียวกับสรุปวันนี้/ประวัติกะ)
  if (!canViewReports(staff.role)) {
    redirect("/admin/menu");
  }

  const params = await searchParams;
  const { t } = await getT();
  const currency = staff.branch.currency;
  const timezone = staff.branch.timezone;

  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const resolved = resolveReportRange({ ...params, todayYmd });

  if (!resolved.ok) {
    return (
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 lg:p-8">
        <h1 className="display text-[26px]">{t("admin.reports.title")}</h1>
        <p role="alert" className="alert">
          {t(resolved.errorKey, { days: MAX_REPORT_DAYS })}
        </p>
      </main>
    );
  }

  const range = resolved.range;
  const report = await getSalesReport(staff.branchId, range, timezone);
  const exportHref = `/admin/reports/export?type=sales&from=${range.fromDay}&to=${range.toDay}`;

  const money = (amount: number) => formatMoney(amount, currency);
  // อย่างน้อย 1 กัน 0/0 ตอนไม่มียอดเลย — แถบจะกว้าง 0% ทุกอันซึ่งถูกแล้ว
  const peakDay = Math.max(1, ...report.byDay.map((row) => row.revenue));
  const peakHour = Math.max(1, ...report.byHour.map((row) => row.revenue));

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="display text-[26px]">{t("admin.reports.title")}</h1>
        <p className="kicker whitespace-nowrap">
          {range.fromDay} — {range.toDay}
        </p>
      </div>

      <RangePicker range={range} exportHref={exportHref} />

      <p className="kicker">{t("admin.reports.paidOnly")}</p>

      {report.billCount === 0 ? (
        <p className="panel p-6">{t("admin.reports.empty")}</p>
      ) : (
        <>
          <div className="ink-grid ink-grid-sparse grid-cols-2 lg:grid-cols-4">
            <Stat label={t("admin.reports.revenue")} value={money(report.revenue)} />
            <Stat label={t("admin.reports.bills")} value={String(report.billCount)} />
            <Stat label={t("admin.reports.averageBill")} value={money(report.averageBill)} />
            <Stat label={t("admin.reports.itemsSold")} value={String(report.itemsSold)} />
          </div>

          <Section title={t("admin.reports.byDay")}>
            {report.byDay.map((row) => (
              <Bar
                key={row.day}
                label={row.day}
                value={money(row.revenue)}
                ratio={row.revenue / peakDay}
              />
            ))}
          </Section>

          <Section title={t("admin.reports.byHour")}>
            {report.byHour
              .filter((row) => row.billCount > 0)
              .map((row) => (
                <Bar
                  key={row.hour}
                  label={`${String(row.hour).padStart(2, "0")}:00`}
                  value={money(row.revenue)}
                  ratio={row.revenue / peakHour}
                />
              ))}
          </Section>

          <Section title={t("admin.reports.byItem")}>
            {report.byItem.map((row) => (
              <Line
                key={row.menuItemId}
                label={`${row.name} × ${row.quantity}`}
                value={money(row.revenue)}
              />
            ))}
          </Section>

          <Section title={t("admin.reports.byStaff")}>
            {report.byStaff.map((row) => (
              <Line
                key={row.staffId ?? "unassigned"}
                label={row.name ?? t("admin.reports.unassigned")}
                value={money(row.total)}
                hint={`${t("admin.reports.discountGiven")} ${money(row.discountTotal)}`}
              />
            ))}
          </Section>

          <Section title={t("admin.reports.byMethod")}>
            {report.byMethod.map((row) => (
              <Line
                key={row.method}
                label={t(paymentMethodKey(row.method))}
                value={money(row.total)}
                hint={String(row.count)}
              />
            ))}
          </Section>
        </>
      )}

      {/* บอกตรง ๆ ว่าอะไรยังไม่มีและเพราะอะไร ดีกว่าคอลัมน์ที่เป็น 0 ตลอดกาล */}
      <p className="kicker">{t("admin.reports.notYet")}</p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-[var(--color-bg)] p-5">
      <span className="kicker">{label}</span>
      <span className="display text-[26px] tabular-nums">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel flex flex-col gap-2 p-5">
      <h2 className="kicker">{title}</h2>
      {children}
    </section>
  );
}

function Bar({ label, value, ratio }: { label: string; value: string; ratio: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="kicker w-[86px] flex-none tabular-nums">{label}</span>
      <span className="h-3 flex-1 bg-[var(--color-neutral-200)]">
        <span
          className="block h-full bg-[var(--color-accent)]"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
      <span className="display w-[110px] flex-none text-right text-[14px] tabular-nums">
        {value}
      </span>
    </div>
  );
}

function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="min-w-0">{label}</span>
      <span className="flex items-baseline gap-3">
        {hint ? <span className="kicker">{hint}</span> : null}
        <span className="display tabular-nums">{value}</span>
      </span>
    </div>
  );
}
