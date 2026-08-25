import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { StaffRole, StaffScreenKind } from "@/lib/generated/prisma/enums";
import { STAFF_ROLE_LABEL, canAccessScreen, canAssignRole, canManageStaff, canManageStaffMember } from "@/lib/rbac";
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
const SCREEN_LABEL: Record<StaffScreenKind, string> = {
  POS: "Staff terminal (POS)",
  KDS: "Kitchen display",
  ADMIN: "Back office",
};

/** เหตุผลที่ session ถูกปิด — ค่าดิบมาจาก SESSION_REVOKE_REASONS */
const REVOKE_LABEL: Record<string, string> = {
  logout: "Locked screen",
  revoked_all: "Signed out",
  pin_reset: "PIN reset",
  deactivated: "Account deactivated",
};

const ALL_ROLES: StaffRole[] = ["OWNER", "MANAGER", "CASHIER", "SERVER", "KITCHEN"];

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
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

  if (staffId === "new") {
    return (
      <Shell title="Add staff member" subtitle="Set code, name, role, and initial PIN">
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

  const disabledReason = isSelf
    ? "You can't edit your own account from this screen — have another authorized user do it"
    : !canEditTarget
      ? "You can't edit an account of this role"
      : undefined;

  return (
    <Shell
      title={`${detail.staff.code} · ${detail.staff.name}`}
      subtitle={`${STAFF_ROLE_LABEL[detail.staff.role]} · ${
        detail.staff.isActive ? "Active" : "Deactivated"
      }`}
    >
      <section className="panel flex flex-col gap-4 p-5">
        <span className="display text-[17px]">Account info</span>
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
          <span className="display text-[17px]">PIN</span>
          <span className="kicker">
            Setting a new PIN signs this person out of every device immediately — they must enter the new PIN to get back in.
          </span>
        </div>
        <ResetPinForm staffId={detail.staff.id} disabled={!canEditTarget && !isSelf} />
      </section>

      <section className="panel flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="display text-[17px]">Signed-in devices</span>
          <span className="kicker">
            {detail.sessions.length === 0
              ? "No devices currently signed in"
              : `${detail.sessions.length} device(s)`}
          </span>
        </div>

        {detail.sessions.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {detail.sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-divider)] pb-2 last:border-b-0"
              >
                <span>{SCREEN_LABEL[session.screen]}</span>
                <span className="kicker tabular-nums">
                  Signed in {formatDateTime(session.createdAt, staff.branch.timezone)}
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
          <span className="display text-[17px]">Sign-in history</span>
          <span className="kicker">Last {detail.history.length} entries</span>
        </div>

        {detail.history.length === 0 ? (
          <p className="text-[var(--color-neutral-700)]">Never signed in</p>
        ) : (
          <ul className="flex flex-col">
            {detail.history.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-divider)] py-2 last:border-b-0"
              >
                <span className="tabular-nums">
                  {formatDateTime(entry.createdAt, staff.branch.timezone)} ·{" "}
                  {SCREEN_LABEL[entry.screen]}
                </span>
                <span className="kicker">
                  {entry.revokedAt
                    ? `${REVOKE_LABEL[entry.revokedReason ?? ""] ?? entry.revokedReason ?? "Closed"}${
                        entry.revokedBy ? ` by ${entry.revokedBy.name}` : ""
                      }`
                    : entry.stillValid
                      ? "Still active"
                      : "Expired"}
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
  children,
}: {
  title: string;
  subtitle: string;
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
          ‹ Back to list
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
