"use client";

import { useT } from "@/components/i18n-provider";
import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import type { Currency } from "@/lib/generated/prisma/enums";
import { formatMoney } from "@/lib/money";

import {
  cancelItemAction,
  closeTableAction,
  mergeTableAction,
  moveTableAction,
  openSalePointAction,
  openTableAction,
  posPlaceOrderAction,
  posServeItemAction,
  posSetLineQuantityAction,
  setCustomerNameAction,
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

/**
 * เปิดบิลซื้อกลับใบใหม่
 *
 * ไม่ถามจำนวนลูกค้าต่างจาก `OpenTableForm` โดยตั้งใจ — ลูกค้าซื้อกลับไม่ได้นั่ง
 * "จำนวนคนต่อโต๊ะ" จึงไม่มีความหมายและไม่ควรไปปนในยอดขายต่อหัวของบทที่ 15
 *
 * เป็นปุ่มเดียวจบ ไม่มีฟอร์มให้กรอก เพราะจังหวะที่กดคือตอนลูกค้ายืนอยู่ตรงหน้า
 * แล้วกำลังจะเริ่มบอกออร์เดอร์ — อะไรที่ต้องกรอกก่อนถึงจะเริ่มรับออร์เดอร์ได้
 * จะกลายเป็นของที่พนักงานกรอกมั่ว ๆ ให้ผ่าน ๆ ไป (ชื่อลูกค้าเติมทีหลังได้)
 */
export function OpenSalePointForm({ tableId, label }: { tableId: string; label: string }) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    openSalePointAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tableId" value={tableId} />

      {state.status === "error" ? (
        <p role="alert" className="alert">
          {t(state.messageKey, state.params)}
        </p>
      ) : null}

      <SubmitButton className="btn btn-accent h-14 px-6 text-[16px]" pendingLabel="Opening bill…">
        {label}
      </SubmitButton>
    </form>
  );
}

/** เปิดโต๊ะ — ถามจำนวนลูกค้าเพื่อเอาไปทำยอดขายต่อหัวในบทที่ 15 */
export function OpenTableForm({ tableId, seats }: { tableId: string; seats: number }) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    openTableAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tableId" value={tableId} />

      <label htmlFor={`pax-${tableId}`} className="kicker">
        Number of guests
      </label>
      <select
        id={`pax-${tableId}`}
        name="pax"
        defaultValue={Math.min(seats, 4)}
        className="input display h-14 text-[18px]"
      >
        {Array.from({ length: 20 }, (_, index) => index + 1).map((pax) => (
          <option key={pax} value={pax}>
            {pax} guests
          </option>
        ))}
      </select>

      {state.status === "error" ? (
        <p role="alert" className="alert">
          {t(state.messageKey, state.params)}
        </p>
      ) : null}

      <SubmitButton
        pendingLabel="Opening table..."
        className="btn btn-primary btn-block h-14 text-base"
      >
        Open table
      </SubmitButton>
    </form>
  );
}

/**
 * ปิดรอบโต๊ะแบบไม่คิดเงิน — ใช้เฉพาะโต๊ะที่ยังไม่มีบิลเข้าครัว
 * ซ่อนไว้ใน <details> เพราะเป็นปุ่มที่ไม่ควรกดพลาด และบังคับกรอกเหตุผลก่อนเสมอ
 */
export function CloseTableForm({ sessionId }: { sessionId: string }) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    closeTableAction,
    IDLE_FORM_STATE,
  );

  return (
    <details className="panel p-4">
      <summary className="kicker cursor-pointer">
        Close table without payment (opened wrong table / customer left before ordering)
      </summary>

      <form action={formAction} className="flex flex-col gap-3 pt-4">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input
          name="reason"
          type="text"
          required
          minLength={3}
          maxLength={200}
          placeholder="e.g. opened the wrong table"
          className="input h-12"
        />

        {state.status === "error" ? (
          <p role="alert" className="alert">
            {t(state.messageKey, state.params)}
          </p>
        ) : null}

        <SubmitButton pendingLabel="Closing..." className="btn btn-secondary h-12">
          Confirm close
        </SubmitButton>
      </form>
    </details>
  );
}

/**
 * ชื่อลูกค้าของบิลซื้อกลับ — ไม่บังคับกรอก
 *
 * อยู่ในแท็บ "บิลที่ส่งแล้ว" ซึ่งเป็นโซนที่ **เลื่อนได้** โดยตั้งใจ ไม่ใช่ในตะกร้า
 * หรือบนหัวจอที่เป็น `flex-none` — ของที่เพิ่มในโซน flex-none จะไปกินพื้นที่ของ
 * โซนที่เลื่อนได้เสมอ (กฎที่ CLAUDE.md บันทึกไว้หลังบั๊ก "รวมทั้งสิ้นหายจากจอ")
 *
 * ปุ่มเดียวใช้ได้ทั้งตั้งชื่อและล้างชื่อ — ส่งช่องว่างมา = ล้าง จึงไม่ต้องมีปุ่มลบ
 * แยกอีกใบให้กดผิด
 */
export function CustomerNameForm({
  sessionId,
  customerName,
  maxLength,
}: {
  sessionId: string;
  customerName: string | null;
  maxLength: number;
}) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    setCustomerNameAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="panel flex flex-col gap-3 p-4">
      <label className="flex flex-col gap-1">
        <span className="kicker">Customer name (optional — used when calling the order)</span>
        <input
          name="customerName"
          type="text"
          defaultValue={customerName ?? ""}
          maxLength={maxLength}
          placeholder="e.g. Nat"
          className="input h-12"
        />
      </label>

      <input type="hidden" name="sessionId" value={sessionId} />

      {state.status === "error" ? (
        <p role="alert" className="alert">
          {t(state.messageKey, state.params)}
        </p>
      ) : null}
      {state.status === "success" ? <p className="kicker">{t(state.messageKey, state.params)}</p> : null}

      <SubmitButton pendingLabel="Saving..." className="btn btn-secondary h-12">
        Save name
      </SubmitButton>
    </form>
  );
}

/**
 * ย้ายโต๊ะ / รวมบิลกับโต๊ะอื่น (งานค้างจากบทที่ 9)
 *
 * ── ทำไมสองกลุ่ม ไม่ใช่รายชื่อโต๊ะชุดเดียว ──────────────────────────────
 * "ย้ายไปโต๊ะว่าง" กับ "รวมกับโต๊ะที่มีคน" เป็นคนละการกระทำที่กู้คืนต่างกันคนละแบบ:
 * ย้ายผิดโต๊ะแก้ได้ด้วยการย้ายกลับ แต่รวมผิดโต๊ะ **แยกกลับไม่ได้** เพราะของอาจถูก
 * เสิร์ฟ/ยกเลิกไปแล้ว รายชื่อชุดเดียวที่ตัดสินให้เองว่าจะทำอันไหนคือปุ่มที่ทำ
 * สิ่งที่กู้ไม่ได้เมื่อคนกดเผลอเลือกผิดหนึ่งบรรทัด
 *
 * ปุ่มรวมจึงมีขั้นยืนยันที่ **บอกยอดของทั้งสองบิล** ก่อนเสมอ — คนกดต้องเห็นว่า
 * กำลังจะรวมเงินก้อนไหนเข้ากับก้อนไหน ไม่ใช่เห็นแค่ชื่อโต๊ะ
 *
 * อยู่ในแท็บ "บิลที่ส่งแล้ว" ซึ่งเป็นโซนที่เลื่อนได้ ไม่ใช่โซน `flex-none`
 * (กฎเดียวกับ `CustomerNameForm`)
 */
export function MoveTableForm({
  sessionId,
  currentTotal,
  currency,
  free,
  occupied,
}: {
  sessionId: string;
  /** ยอดของบิลใบนี้ตอนนี้ — ใช้บอกยอดหลังรวมบนขั้นยืนยัน */
  currentTotal: number;
  currency: Currency;
  free: { id: string; name: string }[];
  occupied: { id: string; name: string; sessionId: string; total: number }[];
}) {
  const { t } = useT();
  const [moveState, moveAction] = useActionState<FormState, FormData>(
    moveTableAction,
    IDLE_FORM_STATE,
  );
  const [mergeState, mergeAction] = useActionState<FormState, FormData>(
    mergeTableAction,
    IDLE_FORM_STATE,
  );

  return (
    <details className="panel p-4">
      <summary className="kicker cursor-pointer">Move table / merge with another table</summary>

      <div className="flex flex-col gap-4 pt-4">
        {moveState.status === "error" ? (
          <p role="alert" className="alert">
            {t(moveState.messageKey, moveState.params)}
          </p>
        ) : null}
        {mergeState.status === "error" ? (
          <p role="alert" className="alert">
            {t(mergeState.messageKey, mergeState.params)}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="kicker">Move the whole bill to an empty table</p>

          {free.length === 0 ? (
            <p className="text-[14px] text-[var(--color-neutral-700)]">
              No empty tables in this branch right now.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {free.map((target) => (
                <form key={target.id} action={moveAction}>
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <input type="hidden" name="targetTableId" value={target.id} />

                  <SubmitButton pendingLabel="Moving..." className="btn btn-secondary h-11 px-4">
                    Move to {target.name}
                  </SubmitButton>
                </form>
              ))}
            </div>
          )}
        </div>

        <div className="rule" />

        <div className="flex flex-col gap-2">
          <p className="kicker">Merge this bill with an occupied table</p>

          {occupied.length === 0 ? (
            <p className="text-[14px] text-[var(--color-neutral-700)]">
              No other tables have an open bill right now.
            </p>
          ) : (
            occupied.map((target) => (
              <details key={target.id} className="border-2 border-[var(--color-text)] p-3">
                <summary className="cursor-pointer text-[15px]">
                  Merge with {target.name} · {formatMoney(target.total, currency)}
                </summary>

                <form action={mergeAction} className="flex flex-col gap-3 pt-3">
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <input type="hidden" name="targetSessionId" value={target.sessionId} />

                  <p className="text-[14px] leading-relaxed">
                    This bill ({formatMoney(currentTotal, currency)}) will be merged into table{" "}
                    {target.name} ({formatMoney(target.total, currency)}) —{" "}
                    {/* ยอดจริงคิดใหม่ครั้งเดียวบนยอดรวมตอนคิดเงิน ตัวเลขนี้จึงเป็นค่าประมาณ */}
                    the merged total will be approximately{" "}
                    <strong>{formatMoney(currentTotal + target.total, currency)}</strong>{" "}
                    <br />
                    Once merged, <strong>it can&apos;t be split back into two bills</strong> — guests at
                    this table will pay together with table {target.name}.
                  </p>

                  <SubmitButton
                    pendingLabel="Merging..."
                    className="btn btn-primary h-12 self-start px-5"
                  >
                    Confirm merge with {target.name}
                  </SubmitButton>
                </form>
              </details>
            ))
          )}
        </div>
      </div>
    </details>
  );
}

/** ยกเลิกอาหารหนึ่งรายการ — บังคับกรอกเหตุผล แล้วเขียนลง AuditLog */
/**
 * "เสิร์ฟแล้ว" ของบรรทัดที่ครัวทำเสร็จ (READY → SERVED) — บทที่ 8
 *
 * ต้องมีที่นี่ด้วยนอกจากบนจอครัว เพราะจอครัวแสดงเฉพาะของที่ผ่านครัว
 * ของที่หยิบเอง (น้ำเปล่า) ไม่เคยขึ้นจอครัวเลย จึงต้องปิดจากหน้านี้เท่านั้น
 */
export function ServeItemForm({ orderItemId }: { orderItemId: string }) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    posServeItemAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="orderItemId" value={orderItemId} />

      <SubmitButton pendingLabel="..." className="btn btn-secondary h-9 whitespace-nowrap">
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

export function CancelItemForm({ orderItemId }: { orderItemId: string }) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    cancelItemAction,
    IDLE_FORM_STATE,
  );

  return (
    <details className="mt-1">
      <summary className="kicker kicker-accent cursor-pointer">Cancel this item</summary>

      <form action={formAction} className="flex flex-col gap-2 pt-2">
        <input type="hidden" name="orderItemId" value={orderItemId} />
        <input
          name="reason"
          type="text"
          required
          minLength={3}
          maxLength={200}
          placeholder="e.g. customer changed their mind / out of stock"
          className="input"
        />

        {state.status === "error" ? (
          <p role="alert" className="alert">
            {t(state.messageKey, state.params)}
          </p>
        ) : null}

        <SubmitButton pendingLabel="Cancelling..." className="btn btn-secondary h-10 self-start">
          Confirm cancel
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
  sessionId,
  orderItemId,
  quantity,
}: {
  tableId: string;
  /** บิลใบไหน — จำเป็นเฉพาะจุดขายที่มีหลายบิลเปิดพร้อมกัน (เคาน์เตอร์ซื้อกลับ) */
  sessionId?: string;
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
        <input type="hidden" name="sessionId" value={sessionId ?? ""} />
        <input type="hidden" name="tableId" value={tableId} />
        <input type="hidden" name="orderItemId" value={orderItemId} />
        <input type="hidden" name="quantity" value={quantity - 1} />
        <SubmitButton
          pendingLabel="…"
          className={quantity === 1 ? "text-[13px]" : undefined}
        >
          {quantity === 1 ? "Remove" : "−"}
        </SubmitButton>
      </form>

      <span className="stepper-value">{quantity}</span>

      <form action={formAction}>
        <input type="hidden" name="sessionId" value={sessionId ?? ""} />
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
  sessionId,
  itemCount,
  label,
}: {
  tableId: string;
  sessionId?: string;
  itemCount: number;
  label: string;
}) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    posPlaceOrderAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tableId" value={tableId} />
      <input type="hidden" name="sessionId" value={sessionId ?? ""} />

      {state.status === "error" ? (
        <p role="alert" className="alert">
          {t(state.messageKey, state.params)}
        </p>
      ) : null}

      <SubmitButton
        pendingLabel="Sending to kitchen..."
        disabled={itemCount === 0}
        className="btn btn-primary btn-block h-[52px] text-base"
      >
        {label}
      </SubmitButton>
    </form>
  );
}
