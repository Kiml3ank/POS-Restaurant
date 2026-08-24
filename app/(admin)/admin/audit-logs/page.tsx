import Link from "next/link";
import { redirect } from "next/navigation";

import type { Currency } from "@/lib/generated/prisma/enums";
import { AUDIT_SENSITIVE_ACTIONS, auditActionLabel, auditMetadataFields } from "@/lib/audit-log";
import { CURRENCIES, formatMoney } from "@/lib/money";
import { STAFF_ROLE_LABEL, canAccessScreen } from "@/lib/rbac";
import type { StaffRole } from "@/lib/generated/prisma/enums";
import { listAuditLogs } from "@/lib/server/audit";
import { getCurrentStaff } from "@/lib/server/staff-session";

/**
 * บันทึกการใช้งาน / AuditLog (บทที่ 13)
 *
 * ── หน้านี้คือ "เครื่องมือ" ของปุ่มส่วนลด ────────────────────────────────
 * ส่วนลดพนักงานเป็นช่องโกงที่เปิดขึ้นในก้อนเดียวกันนี้ การมีปุ่มโดยไม่มีใครอ่าน log ได้
 * = เปิดช่องแล้วไม่มีใครมอง สองอย่างนี้จึงต้องมาพร้อมกันเสมอ
 *
 * ── ตัวกรองอยู่ใน URL ไม่ใช่ state ──────────────────────────────────────
 * ฟอร์ม GET ธรรมดา ไม่มี "use client" ทั้งหน้า — แชร์ลิงก์ผลค้นให้คนอื่นดูได้
 * กด back กลับผลเดิม และโหลดครั้งเดียวจบไม่ต้องรอ JS (เหมือน /admin/receipts)
 */
export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    action?: string;
    staffId?: string;
    entityId?: string;
    page?: string;
  }>;
}) {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  const query = await searchParams;
  const result = await listAuditLogs(staff, {
    from: query.from,
    to: query.to,
    action: query.action,
    staffId: query.staffId,
    entityId: query.entityId,
    page: Number(query.page ?? 1) || 1,
  });

  /**
   * ตัวจัดรูปจำนวนเงินที่ส่งเข้า auditMetadataFields()
   *
   * สกุลเงินมาจากใน metadata เอง ไม่ใช่จาก Branch ปัจจุบัน — บิลเก่าอาจถูกบันทึก
   * ตอนที่สาขายังใช้อีกสกุลหนึ่ง (เคสนี้เกิดจริงใน smoke:payment ที่สลับสาขาเป็น VND)
   * ถ้าอ่านจาก Branch สด ตัวเลขเก่าจะถูกตีความผิดหน่วยโดยไม่มีอะไรฟ้อง
   */
  const formatAmount = (amount: number, currency: string | null) =>
    currency && currency in CURRENCIES
      ? formatMoney(amount, currency as Currency)
      : String(amount);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
        <div className="flex items-baseline gap-3">
          <span className="display text-[19px]">บันทึกการใช้งาน</span>
          <span className="kicker">{result.ok ? `${result.total} รายการ` : "ไม่มีสิทธิ์"}</span>
        </div>
        <span className="kicker">เขียนอย่างเดียว · แก้ไข/ลบไม่ได้</span>
      </header>

      {!result.ok ? (
        <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
          <div className="panel mx-auto mt-8 flex max-w-[520px] flex-col gap-2 p-6">
            <span className="display text-[20px]">อ่านบันทึกการใช้งานไม่ได้</span>
            <p className="text-[var(--color-neutral-700)]">{result.error}</p>
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
              <span className="kicker">การกระทำ</span>
              <select name="action" defaultValue={query.action ?? ""} className="input h-10">
                <option value="">ทั้งหมด</option>
                {/* รายการนี้มาจาก action ที่มีอยู่จริงในฐาน ไม่ได้ hardcode —
                    บทถัดไปที่เพิ่ม action ใหม่จะโผล่เองโดยไม่ต้องแก้ไฟล์นี้ */}
                {result.actions.map((action) => (
                  <option key={action} value={action}>
                    {auditActionLabel(action)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="kicker">พนักงาน</span>
              <select name="staffId" defaultValue={query.staffId ?? ""} className="input h-10">
                <option value="">ทุกคน</option>
                {result.staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[180px] flex-1 flex-col gap-1">
              <span className="kicker">รหัสสิ่งที่ถูกกระทำ (entity id)</span>
              <input
                type="search"
                name="entityId"
                defaultValue={query.entityId ?? ""}
                placeholder="วาง id ของบิล / ใบเสร็จ / รอบโต๊ะ"
                className="input h-10"
              />
            </label>

            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary h-10 text-[14px]">
                ค้นหา
              </button>
              <Link href="/admin/audit-logs" className="btn btn-secondary h-10 text-[14px]">
                ล้าง
              </Link>
            </div>
          </form>

          <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
            {result.rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <p className="display text-[22px]">ไม่พบบันทึกที่ตรงกับตัวกรอง</p>
                <p className="kicker">ลองขยายช่วงวัน หรือล้างตัวกรองแล้วค้นใหม่</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {result.rows.map((row) => {
                  const sensitive = AUDIT_SENSITIVE_ACTIONS.includes(row.action);
                  const fields = auditMetadataFields(row.metadata, formatAmount);

                  return (
                    <li
                      key={row.id}
                      className={`panel ${sensitive ? "border-[var(--color-accent)]" : ""}`}
                    >
                      <div
                        className={`flex flex-wrap items-baseline justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-2.5 ${
                          sensitive ? "bg-[var(--color-accent-200)]" : "bg-[var(--color-neutral-100)]"
                        }`}
                      >
                        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                          <span className="display text-[15px]">
                            {auditActionLabel(row.action)}
                          </span>
                          {/* action ที่ยังไม่มีป้ายไทยจะโชว์ชื่อดิบไปแล้วจากบรรทัดบน
                              จึงไม่ต้องโชว์ซ้ำ — แต่ถ้ามีป้าย ให้เห็นชื่อดิบด้วยเพื่อเอาไปค้นต่อ */}
                          {auditActionLabel(row.action) !== row.action ? (
                            <code className="kicker">{row.action}</code>
                          ) : null}
                        </div>

                        <span className="kicker tabular-nums">
                          {formatLoggedAt(row.createdAt, staff.branch.timezone)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--color-divider)] px-4 py-2 text-[13px]">
                        <span>
                          <span className="kicker">ผู้กระทำ </span>
                          {row.staffName ?? "— (บัญชีถูกลบแล้ว)"}
                          {row.staffRole ? ` · ${STAFF_ROLE_LABEL[row.staffRole as StaffRole]}` : ""}
                        </span>
                        {/* IP ตอบคำถาม "กดจากเครื่องในร้านหรือจากข้างนอก" ซึ่งเป็น
                            คำถามแรกเสมอตอนสืบสวน — แถวเก่าก่อนบทที่ 13 จะว่าง */}
                        <span>
                          <span className="kicker">IP </span>
                          <code className="tabular-nums">{row.ipAddress ?? "—"}</code>
                        </span>
                        <span className="min-w-0">
                          <span className="kicker">{row.entityType} </span>
                          <code className="break-all">{row.entityId}</code>
                        </span>
                      </div>

                      {fields.length > 0 ? (
                        <dl className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2.5 text-[13px]">
                          {fields.map((field) => (
                            <div key={field.label} className="flex items-baseline gap-1.5">
                              <dt className="kicker">{field.label}</dt>
                              <dd className="tabular-nums">{field.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
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

/** ลิงก์เปลี่ยนหน้าที่พาตัวกรองเดิมไปด้วย */
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
      href={`/admin/audit-logs?${params.toString()}`}
      className="btn btn-secondary h-10 text-[14px]"
    >
      {children}
    </Link>
  );
}

/** เวลาตามโซนของสาขา พร้อมวินาที — ลำดับเหตุการณ์ในนาทีเดียวกันคือสิ่งที่ต้องอ่านออก */
function formatLoggedAt(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(at);
}
