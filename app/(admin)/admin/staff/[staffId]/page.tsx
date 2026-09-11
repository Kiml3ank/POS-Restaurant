import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { StaffRole, StaffScreenKind } from "@/lib/generated/prisma/enums";
import type { MessageKey } from "@/lib/i18n/vi";
import {
  canAccessScreen,
  canAssignRole,
  canManageStaff,
  canManageStaffMember,
  staffRoleKey,
} from "@/lib/rbac";
import { getT } from "@/lib/server/locale";
import { getStaffMember } from "@/lib/server/staff-admin";
import { getCurrentStaff } from "@/lib/server/staff-session";

import {
  CreateStaffForm,
  EditStaffForm,
  ResetPinForm,
  RevokeSessionsForm,
} from "../_components/staff-forms";

/**
 * เพิ่ม/แก้พนักงานหนึ่งคน + เครื่องที่ล็อกอินอยู่ + ประวัติการเข้า (บทที่ 13b)
 *
 * `[staffId]` เป็นคำว่า `new` = ฟอร์มเพิ่มคนใหม่ — route เดียวใช้ทั้งสร้างและแก้
 * (ท่าเดียวกับ /admin/menu/item/[id] ในโมดูล 04)
 *
 * ── ทำไม "ประวัติการเข้า" อยู่หน้าเดียวกับปุ่มรีเซ็ต PIN ─────────────────
 * เพราะสองอย่างนี้ถูกใช้ในนาทีเดียวกันเสมอ: ผู้จัดการสงสัยว่ามีคนใช้บัญชีนี้อยู่
 * → ดูว่ามีเครื่องไหนค้าง → เตะออก → รีเซ็ต PIN ถ้ายังไม่มั่นใจ
 * แยกหน้ากันเมื่อไหร่ ขั้นตอนกลางจะถูกข้ามทุกครั้ง
 */
/** คีย์ป้ายของหน้าจอที่ session ผูกอยู่ — ชนิดเป็น MessageKey เพิ่มค่าใน enum แล้วลืมแปล tsc ฟ้อง */
function screenKey(screen: StaffScreenKind): MessageKey {
  return `staffScreen.${screen}`;
}

/**
 * เหตุผลที่ session ถูกปิด — ค่าดิบมาจาก SESSION_REVOKE_REASONS (string ในฐาน)
 * ค่าที่ยังไม่มีป้าย **แสดงดิบ** ไม่ใช่ซ่อน (กติกาเดียวกับ AuditLog)
 */
const REVOKE_KEYS: Record<string, MessageKey> = {
  logout: "revokeReason.logout",
  revoked_all: "revokeReason.revoked_all",
  pin_reset: "revokeReason.pin_reset",
  deactivated: "revokeReason.deactivated",
};

const ALL_ROLES: StaffRole[] = ["OWNER", "MANAGER", "CASHIER", "SERVER", "KITCHEN"];

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { t, tc } = await getT();
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  if (!canManageStaff(staff.role)) {
    redirect("/admin/staff");
  }

  const { staffId } = await params;

  // ตำแหน่งที่คนกดตั้งให้คนอื่นได้จริง — กรองที่ server ไม่ใช่ซ่อนด้วย CSS
  const assignableRoles = ALL_ROLES.filter((role) => canAssignRole(staff.role, role));
  const backLabel = t("admin.staff.back");

  if (staffId === "new") {
    return (
      <Shell title={t("admin.staff.add")} subtitle={t("admin.staff.addSubtitle")} backLabel={backLabel}>
        <section className="panel flex flex-col gap-4 p-5">
          <CreateStaffForm roles={assignableRoles} />
        </section>
      </Shell>
    );
  }

  const detail = await getStaffMember(staff.branchId, staffId);

  if (!detail) {
    notFound();
  }

  const isSelf = detail.staff.id === staff.id;
  const canEditTarget = canManageStaffMember(staff.role, detail.staff.role);

  // ข้อความเดียวกับที่ server คืนเมื่อถูกปฏิเสธ (lib/server/staff-admin.ts) — ใช้คีย์ร่วมกัน
  const disabledReason = isSelf
    ? t("error.cannot_edit_own_account")
    : !canEditTarget
      ? t("error.cannot_edit_this_role")
      : undefined;

  const revokeLabel = (reason: string | null) =>
    reason && Object.hasOwn(REVOKE_KEYS, reason) ? t(REVOKE_KEYS[reason]) : (reason ?? t("admin.staff.closed"));

  return (
    <Shell
      title={`${detail.staff.code} · ${detail.staff.name}`}
      subtitle={`${t(staffRoleKey(detail.staff.role))} · ${t(
        detail.staff.isActive ? "common.active" : "common.deactivated",
      )}`}
      backLabel={backLabel}
    >
      <section className="panel flex flex-col gap-4 p-5">
        <span className="display text-[17px]">{t("admin.staff.accountInfo")}</span>
        <EditStaffForm
          staffId={detail.staff.id}
          code={detail.staff.code}
          name={detail.staff.name}
          role={detail.staff.role}
          isActive={detail.staff.isActive}
          roles={assignableRoles.length > 0 ? assignableRoles : [detail.staff.role]}
          disabledReason={disabledReason}
        />
      </section>

      <section className="panel flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="display text-[17px]">{t("pin.pin")}</span>
          <span className="kicker">{t("admin.staff.pinHint")}</span>
        </div>
        <ResetPinForm staffId={detail.staff.id} disabled={!canEditTarget && !isSelf} />
      </section>

      <section className="panel flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="display text-[17px]">{t("admin.staff.devicesTitle")}</span>
          <span className="kicker">
            {detail.sessions.length === 0
              ? t("msg.no_active_sessions")
              : tc("admin.staff.devices", detail.sessions.length)}
          </span>
        </div>

        {detail.sessions.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {detail.sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-divider)] pb-2 last:border-b-0"
              >
                <span>{t(screenKey(session.screen))}</span>
                <span className="kicker tabular-nums">
                  {t("admin.staff.signedInAt", {
                    time: formatDateTime(session.createdAt, staff.branch.timezone),
                  })}
                  {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <RevokeSessionsForm staffId={detail.staff.id} activeSessions={detail.sessions.length} />
      </section>

      <section className="panel flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="display text-[17px]">{t("admin.staff.history")}</span>
          <span className="kicker">{tc("admin.staff.historyCount", detail.history.length)}</span>
        </div>

        {detail.history.length === 0 ? (
          <p className="text-[var(--color-neutral-700)]">{t("admin.staff.neverSignedIn")}</p>
        ) : (
          <ul className="flex flex-col">
            {detail.history.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-divider)] py-2 last:border-b-0"
              >
                <span className="tabular-nums">
                  {formatDateTime(entry.createdAt, staff.branch.timezone)} ·{" "}
                  {t(screenKey(entry.screen))}
                </span>
                <span className="kicker">
                  {entry.revokedAt
                    ? entry.revokedBy
                      ? t("admin.staff.revokedBy", {
                          reason: revokeLabel(entry.revokedReason),
                          name: entry.revokedBy.name,
                        })
                      : revokeLabel(entry.revokedReason)
                    : t(entry.stillValid ? "admin.staff.stillActive" : "admin.staff.expired")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}

function Shell({
  title,
  subtitle,
  backLabel,
  children,
}: {
  title: string;
  subtitle: string;
  /** แปลแล้วจากตัวแม่ — Shell เป็น server component ธรรมดา */
  backLabel: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-4 py-3 lg:px-6">
        <div className="flex min-w-0 flex-col">
          <span className="display text-[19px]">{title}</span>
          <span className="kicker">{subtitle}</span>
        </div>

        <Link href="/admin/staff" className="btn btn-ghost h-10 text-[14px]">
          {backLabel}
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">{children}</div>
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
