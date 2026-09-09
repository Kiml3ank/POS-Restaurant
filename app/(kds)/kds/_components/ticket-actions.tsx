"use client";

import { useT } from "@/components/i18n-provider";
import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import {
  KITCHEN_ACTION_LABEL,
  type KitchenActionableStatus,
} from "@/lib/order-status";

import { advanceItemAction, advanceTicketAction, serveItemAction } from "../actions";

/**
 * ปุ่มทั้งหมดของจอครัว (บทที่ 8)
 *
 * แยกเป็น client component เฉพาะปุ่ม ส่วนตัวใบสั่งยังเป็น Server Component
 * — จอครัวมีใบสั่งพร้อมกันได้หลายสิบใบ ถ้าทำทั้งใบเป็น client component
 * ทุกครั้งที่ refresh จะต้องส่ง props ของทุกใบข้ามไปฝั่ง client ใหม่ทั้งหมด
 *
 * ปุ่มทุกตัวเป็น <form> + Server Action ไม่ใช่ fetch เอง เพราะได้สามอย่างฟรี:
 * กันกดรัวด้วย useFormStatus, ทำงานได้แม้ JS ยังโหลดไม่เสร็จ และไม่ต้องเขียน
 * ตรรกะ error/สิทธิ์ซ้ำฝั่ง client
 */

/** ปุ่มหลักของครัว: PLACED → "รับออร์เดอร์" · IN_PROGRESS → "ทำเสร็จแล้ว" */
export function AdvanceItemButton({
  orderItemId,
  status,
  disabled = false,
}: {
  orderItemId: string;
  status: KitchenActionableStatus;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    advanceItemAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="orderItemId" value={orderItemId} />

      <SubmitButton
        pendingLabel="..."
        disabled={disabled}
        className={`btn h-11 min-w-[110px] text-[15px] sm:min-w-[132px] ${
          status === "PLACED" ? "btn-secondary" : "btn-primary"
        }`}
      >
        {KITCHEN_ACTION_LABEL[status]}
      </SubmitButton>

      {state.status === "error" ? (
        <span role="alert" className="alert text-[12px]">
          {t(state.messageKey, state.params)}
        </span>
      ) : null}
    </form>
  );
}

/** ปุ่มของพนักงานเสิร์ฟ — โผล่เฉพาะรายการที่ครัวทำเสร็จแล้ว (READY) */
export function ServeItemButton({
  orderItemId,
  disabled = false,
}: {
  orderItemId: string;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    serveItemAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="orderItemId" value={orderItemId} />

      <SubmitButton
        pendingLabel="..."
        disabled={disabled}
        className="btn btn-secondary h-11 min-w-[110px] text-[15px] sm:min-w-[132px]"
      >
        Served
      </SubmitButton>

      {state.status === "error" ? (
        <span role="alert" className="alert text-[12px]">
          {t(state.messageKey, state.params)}
        </span>
      ) : null}
    </form>
  );
}

/**
 * บั๊มทั้งใบ — ปุ่มที่ครัวใช้จริงบ่อยที่สุด
 *
 * วางไว้เต็มความกว้างท้ายใบเพราะเป็นเป้าหมายที่กดด้วยสันมือหรือข้อนิ้วได้
 * โดยไม่ต้องเล็ง (ครัวมือเปียก/เปื้อนน้ำมัน จะไม่จิ้มด้วยปลายนิ้ว)
 */
export function BumpTicketButton({
  orderId,
  stationId,
  label,
  disabled = false,
}: {
  orderId: string;
  stationId: string | null;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    advanceTicketAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      {/* ค่าว่าง = แท็บ "ทุกสถานี" → บั๊มทุกสถานีในบิลนี้ (ดู advanceKitchenTicket) */}
      <input type="hidden" name="stationId" value={stationId ?? ""} />

      <SubmitButton
        pendingLabel="Updating..."
        disabled={disabled}
        className="btn btn-primary btn-block h-12 text-[15px]"
      >
        {label}
      </SubmitButton>

      {state.status === "error" ? (
        <span role="alert" className="alert text-[12px]">
          {t(state.messageKey, state.params)}
        </span>
      ) : null}
    </form>
  );
}
