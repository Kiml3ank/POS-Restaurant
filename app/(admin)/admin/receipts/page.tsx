import Link from "next/link";
import { getT } from "@/lib/server/locale";
import { redirect } from "next/navigation";

import { LiveRefresh } from "@/components/live-refresh";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import { formatMoney } from "@/lib/money";
import { paymentMethodKey } from "@/lib/payment-method";
import { canAccessScreen } from "@/lib/rbac";
import { salePointDisplayName } from "@/lib/sale-point";
import { listReceipts } from "@/lib/server/receipt";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * ลิสต์ใบเสร็จย้อนหลัง (บทที่ 12) — "Receipt management" + "Payment records"
 *
 * ── ตัวกรองอยู่ใน URL ไม่ใช่ใน state ────────────────────────────────────
 * ฟอร์มเป็น GET ธรรมดา ไม่มี "use client" เลยทั้งหน้า ซึ่งได้สามอย่างฟรี:
 * แชร์ลิงก์ผลค้นให้ผู้จัดการอีกคนได้ · กด back แล้วกลับไปผลเดิม · โหลดครั้งเดียวจบ
 * ไม่ต้องรอ JS — สำคัญบนแท็บเล็ตหน้าร้านที่เน็ตไม่ดี
 *
 * ── ทำไมกรองวันที่ส่งเป็น YYYY-MM-DD ไม่ใช่ timestamp ───────────────────
 * เพราะ "วันที่" ที่ผู้จัดการหมายถึงคือวันตามเวลาของสาขา การแปลงเป็นช่วง UTC
 * เกิดที่ listReceipts() ที่เดียว (ดูเหตุผลเต็มในไฟล์นั้น)
 */

const METHOD_OPTIONS: readonly PaymentMethod[] = ["CASH", "QR", "CARD"];

export default async function AdminReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; method?: string; q?: string; page?: string }>;
}) {
  const { t } = await getT();
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  const query = await searchParams;
  const method = METHOD_OPTIONS.includes(query.method as PaymentMethod)
    ? (query.method as PaymentMethod)
    : null;

  const result = await listReceipts(staff, {
    from: query.from,
    to: query.to,
    method,
    q: query.q,
    page: Number(query.page ?? 1) || 1,
  });

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
        <div className="flex items-baseline gap-3">
          <span className="display text-[19px]">ใบเสร็จ</span>
          <span className="kicker">{result.ok ? `${result.total} ใบ` : "ไม่มีสิทธิ์"}</span>
        </div>
        {/* บิลใหม่เกิดได้ตลอดเวลาที่ร้านเปิด — ลิสต์ที่ค้างภาพทำให้กระทบยอดผิด */}
        <LiveRefresh src="/api/realtime" />
      </header>

      {!result.ok ? (
        <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
          <div className="panel mx-auto mt-8 flex max-w-[520px] flex-col gap-2 p-6">
            <span className="display text-[20px]">ดูใบเสร็จย้อนหลังไม่ได้</span>
            <p className="text-[var(--color-neutral-700)]">{t(result.errorKey, result.params)}</p>
            <p className="kicker mt-2">
              พิมพ์ใบให้ลูกค้าที่ยืนอยู่ตรงหน้าได้จากหน้าคิดเงินที่จอ POS
            </p>
          </div>
        </div>
      ) : (
        <>
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 border-b-2 border-[var(--color-text)] bg-[var(--color-neutral-100)] px-4 py-3 lg:px-6"
          >
            <label className="flex flex-col gap-1">
              <span className="kicker">ตั้งแต่วันที่</span>
              <input type="date" name="from" defaultValue={query.from ?? ""} className="input h-10" />
            </label>

            <label className="flex flex-col gap-1">
              <span className="kicker">ถึงวันที่</span>
              <input type="date" name="to" defaultValue={query.to ?? ""} className="input h-10" />
            </label>

            <label className="flex flex-col gap-1">
              <span className="kicker">วิธีจ่าย</span>
              <select name="method" defaultValue={method ?? ""} className="input h-10">
                <option value="">ทั้งหมด</option>
                {METHOD_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(paymentMethodKey(option))}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[180px] flex-1 flex-col gap-1">
              <span className="kicker">เลขที่ใบ · ชื่อโต๊ะ · เลขคิว</span>
              <input
                type="search"
                name="q"
                defaultValue={query.q ?? ""}
                placeholder="เช่น HQ-00000012 · A3 · คิว 12"
                className="input h-10"
              />
            </label>

            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary h-10 text-[14px]">
                ค้นหา
              </button>
              <Link href="/admin/receipts" className="btn btn-secondary h-10 text-[14px]">
                ล้าง
              </Link>
            </div>
          </form>

          <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
            {result.rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <p className="display text-[22px]">ไม่พบใบเสร็จที่ตรงกับตัวกรอง</p>
                <p className="kicker">ลองขยายช่วงวัน หรือล้างตัวกรองแล้วค้นใหม่</p>
              </div>
            ) : (
              <section className="panel">
                <ul className="flex flex-col">
                  {result.rows.map((row) => (
                    <li
                      key={row.id}
                      className="border-b border-[var(--color-divider)] last:border-b-0"
                    >
                      <Link
                        href={`/admin/receipts/${row.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-accent-100)]"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="display text-[15px] tabular-nums">{row.number}</span>
                          <span className="kicker">
                            {formatIssuedAt(row.issuedAt, staff.branch.timezone)}
                            {` · ${salePointDisplayName(row.salePoint, row.salePoint, t)}`}
                            {row.staffName ? ` · ${row.staffName}` : ""}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* พิมพ์ไปแล้วกี่ใบคือตัวเลขที่ผู้ตรวจสอบมองหา จึงอยู่บนลิสต์
                              ไม่ใช่ต้องเปิดเข้าไปดูทีละใบ */}
                          {row.printCount > 1 ? (
                            <span className="tag tag-accent">พิมพ์ {row.printCount} ครั้ง</span>
                          ) : null}
                          <span className="tag tag-neutral">
                            {t(paymentMethodKey(row.method))}
                          </span>
                          <span className="display w-28 text-right text-[15px] tabular-nums">
                            {formatMoney(row.grandTotal, row.currency)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.pageCount > 1 ? (
              <nav className="mt-4 flex items-center justify-between gap-3">
                <PageLink query={query} page={result.page - 1} disabled={result.page <= 1}>
                  ‹ ก่อนหน้า
                </PageLink>
                <span className="kicker tabular-nums">
                  หน้า {result.page} / {result.pageCount}
                </span>
                <PageLink
                  query={query}
                  page={result.page + 1}
                  disabled={result.page >= result.pageCount}
                >
                  ถัดไป ›
                </PageLink>
              </nav>
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}

/** ลิงก์เปลี่ยนหน้าที่พาตัวกรองเดิมไปด้วย — ไม่งั้นกดหน้า 2 แล้วผลค้นหายหมด */
function PageLink({
  query,
  page,
  disabled,
  children,
}: {
  query: Record<string, string | undefined>;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="btn btn-secondary h-10 text-[14px] opacity-40">{children}</span>;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value && key !== "page") params.set(key, value);
  }
  params.set("page", String(page));

  return (
    <Link
      href={`/admin/receipts?${params.toString()}`}
      className="btn btn-secondary h-10 text-[14px]"
    >
      {children}
    </Link>
  );
}

/** เวลาออกใบตามเวลาของสาขา — render บน server ที่เดียว ไม่มี hydration mismatch */
function formatIssuedAt(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(at);
}
