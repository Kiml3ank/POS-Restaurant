import { amountHeader, csvFileName, toCsv } from "@/lib/csv";
import { canAccessScreen, canViewReports } from "@/lib/rbac";
import { resolveReportRange } from "@/lib/report-range";
import { getT } from "@/lib/server/locale";
import { getSalesReport } from "@/lib/server/reports";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * ส่งออกรายงานเป็น CSV (spec §19)
 *
 * ── ทำไมเป็น Route Handler ไม่ใช่ Server Action ─────────────────────────
 * action คืนค่าให้ React ไม่ได้คืน "ไฟล์ที่เบราว์เซอร์ต้องดาวน์โหลด" —
 * การดาวน์โหลดต้องมี response จริงที่มี `Content-Disposition`
 *
 * ── ต้องตรวจสิทธิ์ในไฟล์นี้เอง ──────────────────────────────────────────
 * URL นี้ยิงตรงได้จากแถบที่อยู่ **การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์**
 * ตอบ 403 ไม่ใช่ redirect เพราะปลายทางเป็นไฟล์ ไม่ใช่หน้า HTML
 * (เหตุผลเดียวกับที่ `/api/realtime` ตอบ 401 ไม่ใช่ redirect ในบทที่ 8)
 */
export async function GET(request: Request) {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin") || !canViewReports(staff.role)) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const timezone = staff.branch.timezone;
  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

  const resolved = resolveReportRange({
    preset: url.searchParams.get("preset"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    todayYmd,
  });

  if (!resolved.ok) {
    return new Response(resolved.errorKey, { status: 400 });
  }

  const { t } = await getT();
  const range = resolved.range;
  const currency = staff.branch.currency;
  const report = await getSalesReport(staff.branchId, range, timezone);
  const type = url.searchParams.get("type") ?? "sales";

  /**
   * ยอดเงินในไฟล์เป็น **จำนวนเต็มหน่วยย่อยดิบ** ไม่ใช่สตริงที่จัดรูปแล้ว —
   * สเปรดชีตต้องบวกคอลัมน์นั้นได้ ส่วนการจัดรูปเป็นเรื่องของหน้าจอ
   * ชื่อคอลัมน์จึงแนบสกุลเงินไว้ด้วยเพื่อให้คนอ่านรู้ว่าหน่วยคืออะไร
   */
  const revenueHeader = amountHeader(t("admin.reports.revenue"), currency);
  const rows: (string | number | null)[][] = [];

  if (type === "byDay") {
    rows.push([t("admin.reports.byDay"), revenueHeader, t("admin.reports.bills")]);
    for (const row of report.byDay) {
      rows.push([row.day, row.revenue, row.billCount]);
    }
  } else if (type === "byHour") {
    rows.push([t("admin.reports.byHour"), revenueHeader, t("admin.reports.bills")]);
    for (const row of report.byHour) {
      rows.push([`${String(row.hour).padStart(2, "0")}:00`, row.revenue, row.billCount]);
    }
  } else if (type === "products") {
    rows.push([t("admin.reports.byItem"), t("admin.reports.itemsSold"), revenueHeader]);
    for (const row of report.byItem) {
      rows.push([row.name, row.quantity, row.revenue]);
    }
  } else if (type === "staff") {
    rows.push([
      t("admin.reports.byStaff"),
      t("admin.reports.bills"),
      revenueHeader,
      amountHeader(t("admin.reports.discountGiven"), currency),
    ]);
    for (const row of report.byStaff) {
      rows.push([
        row.name ?? t("admin.reports.unassigned"),
        row.count,
        row.total,
        row.discountTotal,
      ]);
    }
  } else if (type === "payments") {
    rows.push([t("admin.reports.byMethod"), t("admin.reports.bills"), revenueHeader]);
    for (const row of report.byMethod) {
      rows.push([row.method, row.count, row.total]);
    }
  } else {
    rows.push([t("admin.reports.title"), revenueHeader]);
    rows.push([t("admin.reports.revenue"), report.revenue]);
    rows.push([t("admin.reports.bills"), report.billCount]);
    rows.push([t("admin.reports.averageBill"), report.averageBill]);
    rows.push([t("admin.reports.itemsSold"), report.itemsSold]);
  }

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(type, range)}"`,
      // รายงานเปลี่ยนทุกครั้งที่มีบิลใหม่ — แคชไฟล์นี้ไว้แปลว่าส่งเลขเก่าให้เจ้าของร้าน
      "Cache-Control": "no-store",
    },
  });
}
