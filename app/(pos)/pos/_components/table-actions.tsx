"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";

import {
  cancelItemAction,
  closeTableAction,
  openTableAction,
  posPlaceOrderAction,
  posSetLineQuantityAction,
} from "../actions";

/**
 * ปุ่มสั่งงานทั้งหมดของหน้าโต๊ะ (บทที่ 9)
 *
 * รวมไว้ไฟล์เดียวเพราะทุกตัวเป็นฟอร์มเล็ก ๆ ที่ยิง Server Action คนละตัวแต่
 * หน้าตาเหมือนกันหมด — แยกเป็น 5 ไฟล์แล้วจะเหลือไฟล์ละ 20 บรรทัดที่ต้องไล่เปิดอ่าน
 *
 * ทุกอันเป็น <form> จริง ไม่ใช่ onClick + fetch เพื่อให้ยังกดได้ก่อน JS โหลดเสร็จ
 * และปุ่ม submit ปิดตัวเองระหว่างรอผ่าน useFormStatus (กันกดรัวเหมือนฝั่งลูกค้า)
 *
 * หน้าตาใช้คลาสของ design system ที่ประกาศไว้ใน app/globals.css (.btn, .input,
 * .stepper, .alert) — ห้ามใส่สีดิบลงในไฟล์นี้ ถ้าต้องเพิ่มลุคใหม่ให้ไปเพิ่มคลาส
 * ที่นั่นแทน ไม่งั้นตอนปรับธีมจะต้องไล่แก้ทีละหน้า
 */

/** เปิดโต๊ะ — ถามจำนวนลูกค้าเพื่อเอาไปทำยอดขายต่อหัวในบทที่ 15 */
export function OpenTableForm({ tableId, seats }: { tableId: string; seats: number }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    openTableAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tableId" value={tableId} />

      <label htmlFor={`pax-${tableId}`} className="kicker">
        จำนวนลูกค้า
      </label>
      <select
        id={`pax-${tableId}`}
        name="pax"
        defaultValue={Math.min(seats, 4)}
        className="input display h-14 text-[18px]"
      >
        {Array.from({ length: 20 }, (_, index) => index + 1).map((pax) => (
          <option key={pax} value={pax}>
            {pax} คน
          </option>
        ))}
      </select>

      {state.status === "error" ? (
        <p role="alert" className="alert">
          {state.message}
        </p>
      ) : null}

      <SubmitButton
        pendingLabel="กำลังเปิดโต๊ะ..."
        className="btn btn-primary btn-block h-14 text-base"
      >
        เปิดโต๊ะ
      </SubmitButton>
    </form>
  );
}

/**
 * ปิดรอบโต๊ะแบบไม่คิดเงิน — ใช้เฉพาะโต๊ะที่ยังไม่มีบิลเข้าครัว
 * ซ่อนไว้ใน <details> เพราะเป็นปุ่มที่ไม่ควรกดพลาด และบังคับกรอกเหตุผลก่อนเสมอ
 */
export function CloseTableForm({ sessionId }: { sessionId: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    closeTableAction,
    IDLE_FORM_STATE,
  );

  return (
    <details className="panel p-4">
      <summary className="kicker cursor-pointer">
        ปิดรอบโต๊ะโดยไม่คิดเงิน (เปิดผิดใบ / ลูกค้าลุกไปก่อนสั่ง)
      </summary>

      <form action={formAction} className="flex flex-col gap-3 pt-4">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input
          name="reason"
          type="text"
          required
          minLength={3}
          maxLength={200}
          placeholder="เหตุผล เช่น เปิดโต๊ะผิดใบ"
          className="input h-12"
        />

        {state.status === "error" ? (
          <p role="alert" className="alert">
            {state.message}
          </p>
        ) : null}

        <SubmitButton pendingLabel="กำลังปิดรอบ..." className="btn btn-secondary h-12">
          ยืนยันปิดรอบ
        </SubmitButton>
      </form>
    </details>
  );
}

/** ยกเลิกอาหารหนึ่งรายการ — บังคับกรอกเหตุผล แล้วเขียนลง AuditLog */
export function CancelItemForm({ orderItemId }: { orderItemId: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    cancelItemAction,
    IDLE_FORM_STATE,
  );

  return (
    <details className="mt-1">
      <summary className="kicker kicker-accent cursor-pointer">ยกเลิกรายการนี้</summary>

      <form action={formAction} className="flex flex-col gap-2 pt-2">
        <input type="hidden" name="orderItemId" value={orderItemId} />
        <input
          name="reason"
          type="text"
          required
          minLength={3}
          maxLength={200}
          placeholder="เหตุผล เช่น ลูกค้าเปลี่ยนใจ / ของหมด"
          className="input"
        />

        {state.status === "error" ? (
          <p role="alert" className="alert">
            {state.message}
          </p>
        ) : null}

        <SubmitButton pendingLabel="กำลังยกเลิก..." className="btn btn-secondary h-10 self-start">
          ยืนยันยกเลิก
        </SubmitButton>
      </form>
    </details>
  );
}

/**
 * เพิ่ม/ลด/ลบ ของบรรทัดในตะกร้าที่ยังไม่ส่งเข้าครัว
 *
 * เป็นสองฟอร์มแยกกันแต่ครอบด้วย .stepper ใบเดียว จึงเห็นเป็นกล่องขอบ 2px
 * ชิ้นเดียวตาม design ทั้งที่ข้างในยิงคนละ POST
 */
export function PosLineControls({
  tableId,
  orderItemId,
  quantity,
}: {
  tableId: string;
  orderItemId: string;
  quantity: number;
}) {
  const [, formAction] = useActionState<FormState, FormData>(
    posSetLineQuantityAction,
    IDLE_FORM_STATE,
  );

  return (
    <div className="stepper h-[38px] shrink-0">
      <form action={formAction}>
        <input type="hidden" name="tableId" value={tableId} />
        <input type="hidden" name="orderItemId" value={orderItemId} />
        <input type="hidden" name="quantity" value={quantity - 1} />
        <SubmitButton
          pendingLabel="…"
          className={quantity === 1 ? "text-[13px]" : undefined}
        >
          {quantity === 1 ? "ลบ" : "−"}
        </SubmitButton>
      </form>

      <span className="stepper-value">{quantity}</span>

      <form action={formAction}>
        <input type="hidden" name="tableId" value={tableId} />
        <input type="hidden" name="orderItemId" value={orderItemId} />
        <input type="hidden" name="quantity" value={quantity + 1} />
        <SubmitButton pendingLabel="…" disabled={quantity >= 99}>
          +
        </SubmitButton>
      </form>
    </div>
  );
}

/** ส่งตะกร้าของโต๊ะเข้าครัวในนามพนักงานที่ล็อกอินอยู่ */
export function PosPlaceOrderForm({
  tableId,
  itemCount,
  label,
}: {
  tableId: string;
  itemCount: number;
  label: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    posPlaceOrderAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tableId" value={tableId} />

      {state.status === "error" ? (
        <p role="alert" className="alert">
          {state.message}
        </p>
      ) : null}

      <SubmitButton
        pendingLabel="กำลังส่งเข้าครัว..."
        disabled={itemCount === 0}
        className="btn btn-primary btn-block h-[52px] text-base"
      >
        {label}
      </SubmitButton>
    </form>
  );
}
