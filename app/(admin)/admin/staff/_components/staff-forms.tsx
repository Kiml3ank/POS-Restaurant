"use client";

import { useT } from "@/components/i18n-provider";
import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import type { StaffRole } from "@/lib/generated/prisma/enums";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { staffRoleKey } from "@/lib/rbac";

import {
  createStaffAction,
  resetStaffPinAction,
  revokeStaffSessionsAction,
  updateStaffAction,
} from "../../actions";

/**
 * ฟอร์มทั้งหมดของหน้าจัดการพนักงาน (บทที่ 13b)
 *
 * รวมไว้ไฟล์เดียวด้วยเหตุผลเดียวกับ `pos/_components/table-actions.tsx` —
 * ทุกตัวเป็นฟอร์มเล็ก ๆ ที่ยิง Server Action คนละตัวแต่หน้าตาเหมือนกันหมด
 *
 * **รายการตำแหน่งที่เลือกได้ถูกกรองมาจากฝั่ง server แล้ว** (`assignableRoles`)
 * — ผู้จัดการจะไม่เห็นตัวเลือก "เจ้าของร้าน" เลย แต่นั่นเป็นแค่การไม่วาด
 * ตัวที่กันจริงคือ `canAssignRole()` ใน lib/server/staff-admin.ts ซึ่งตรวจซ้ำทุกครั้ง
 * (การซ่อนปุ่มไม่ใช่การกันสิทธิ์ — กฎประจำโปรเจกต์)
 */

function RoleSelect({
  roles,
  defaultValue,
}: {
  roles: readonly StaffRole[];
  defaultValue?: StaffRole;
}) {
  const { t } = useT();

  return (
    <label className="flex flex-col gap-1">
      <span className="kicker">ตำแหน่ง</span>
      <select name="role" defaultValue={defaultValue ?? roles[0]} className="input h-12">
        {roles.map((role) => (
          <option key={role} value={role}>
            {t(staffRoleKey(role))}
          </option>
        ))}
      </select>
    </label>
  );
}

function Message({ state }: { state: FormState }) {
  const { t } = useT();

  if (state.status === "error") {
    return (
      <p role="alert" className="alert">
        {t(state.messageKey, state.params)}
      </p>
    );
  }

  if (state.status === "success") {
    return <p className="kicker">{t(state.messageKey, state.params)}</p>;
  }

  return null;
}

export function CreateStaffForm({ roles }: { roles: readonly StaffRole[] }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    createStaffAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="kicker">รหัสพนักงาน (ใช้พิมพ์คู่กับ PIN)</span>
          <input name="code" type="text" required maxLength={20} className="input h-12" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">ชื่อที่แสดงบนจอ</span>
          <input name="name" type="text" required maxLength={60} className="input h-12" />
        </label>

        <RoleSelect roles={roles} />

        <label className="flex flex-col gap-1">
          <span className="kicker">PIN ตั้งต้น (ตัวเลข 4-6 หลัก)</span>
          <input
            name="pin"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            minLength={4}
            maxLength={6}
            className="input h-12"
          />
        </label>
      </div>

      <Message state={state} />

      <SubmitButton pendingLabel="กำลังเพิ่ม..." className="btn btn-primary h-12">
        เพิ่มพนักงาน
      </SubmitButton>
    </form>
  );
}

export function EditStaffForm({
  staffId,
  code,
  name,
  role,
  isActive,
  roles,
  disabledReason,
}: {
  staffId: string;
  code: string;
  name: string;
  role: StaffRole;
  isActive: boolean;
  roles: readonly StaffRole[];
  /** มีค่า = แก้ไม่ได้ และนี่คือเหตุผลที่แสดงแทนฟอร์ม */
  disabledReason?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateStaffAction,
    IDLE_FORM_STATE,
  );

  if (disabledReason) {
    return <p className="kicker">{disabledReason}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="staffId" value={staffId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="kicker">รหัสพนักงาน</span>
          <input
            name="code"
            type="text"
            required
            maxLength={20}
            defaultValue={code}
            className="input h-12"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">ชื่อที่แสดงบนจอ</span>
          <input
            name="name"
            type="text"
            required
            maxLength={60}
            defaultValue={name}
            className="input h-12"
          />
        </label>

        <RoleSelect roles={roles} defaultValue={role} />

        <label className="flex items-center gap-3 self-end pb-3">
          <input name="isActive" type="checkbox" defaultChecked={isActive} className="size-5" />
          <span>
            เปิดใช้งาน
            <span className="kicker block">ปิดแล้วเข้าระบบไม่ได้ และเครื่องที่ค้างอยู่หลุดทันที</span>
          </span>
        </label>
      </div>

      <Message state={state} />

      <SubmitButton pendingLabel="กำลังบันทึก..." className="btn btn-primary h-12">
        บันทึกการแก้ไข
      </SubmitButton>
    </form>
  );
}

export function ResetPinForm({ staffId, disabled }: { staffId: string; disabled?: boolean }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    resetStaffPinAction,
    IDLE_FORM_STATE,
  );

  if (disabled) {
    return <p className="kicker">คุณรีเซ็ต PIN ของตำแหน่งนี้ไม่ได้</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="staffId" value={staffId} />

      <label className="flex flex-col gap-1">
        <span className="kicker">PIN ใหม่ (ตัวเลข 4-6 หลัก)</span>
        <input
          name="pin"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          required
          minLength={4}
          maxLength={6}
          className="input h-12"
        />
      </label>

      <Message state={state} />

      <SubmitButton pendingLabel="กำลังตั้ง PIN..." className="btn btn-secondary h-12">
        ตั้ง PIN ใหม่
      </SubmitButton>
    </form>
  );
}

export function RevokeSessionsForm({
  staffId,
  activeSessions,
}: {
  staffId: string;
  activeSessions: number;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    revokeStaffSessionsAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="staffId" value={staffId} />

      <Message state={state} />

      <SubmitButton
        pendingLabel="กำลังเตะออก..."
        className="btn btn-secondary h-12"
        disabled={activeSessions === 0}
      >
        {activeSessions === 0 ? "ไม่มีเครื่องที่ล็อกอินอยู่" : `เตะออกทุกเครื่อง (${activeSessions})`}
      </SubmitButton>
    </form>
  );
}
