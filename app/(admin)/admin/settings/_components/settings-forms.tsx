"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import type { Currency } from "@/lib/generated/prisma/enums";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { CURRENCIES } from "@/lib/money";

import {
  deleteStationAction,
  deleteTableAction,
  rotateTableCodeAction,
  updateBusinessInfoAction,
  updateTaxSettingsAction,
  upsertStationAction,
  upsertTableAction,
} from "../../actions";

/**
 * ฟอร์มของหน้าตั้งค่า (spec §22 §23 §24)
 *
 * ── ช่องกรอกเป็น "เปอร์เซ็นต์" แต่ระบบเก็บเป็น basis point ────────────────
 * เจ้าของร้านคิดเป็น 7% ไม่ใช่ 700 bp — การให้กรอก bp คือการบังคับให้คนแปลงเลข
 * ในหัวทุกครั้ง ซึ่งเป็นที่มาของการพิมพ์ผิดสิบเท่า การแปลงอยู่ที่ `percentToBp()`
 * ฝั่ง server ที่แยกสตริงเอง **ไม่คูณ 100 แบบ float** (เหตุผลเดียวกับ parseMoneyInput)
 */

function Message({ state }: { state: FormState }) {
  if (state.status === "error") {
    return (
      <p role="alert" className="alert">
        {state.message}
      </p>
    );
  }

  if (state.status === "success") {
    return <p className="kicker">{state.message}</p>;
  }

  return null;
}

function bpToPercent(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = bp % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

export function TaxSettingsForm({
  vatRateBp,
  serviceChargeBp,
  staffMealDiscountBp,
  pricesIncludeVat,
  currency,
  timezone,
  currencyLocked,
  disabledReason,
}: {
  vatRateBp: number;
  serviceChargeBp: number;
  staffMealDiscountBp: number;
  pricesIncludeVat: boolean;
  currency: Currency;
  timezone: string;
  /** สาขานี้เคยรับเงินแล้ว = สลับสกุลเงินไม่ได้อีก */
  currencyLocked: boolean;
  disabledReason?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateTaxSettingsAction,
    IDLE_FORM_STATE,
  );

  if (disabledReason) {
    return <p className="kicker">{disabledReason}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="kicker">VAT rate (%)</span>
          <input
            name="vatRatePercent"
            type="text"
            inputMode="decimal"
            required
            defaultValue={bpToPercent(vatRateBp)}
            className="input h-12"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">Service charge (%)</span>
          <input
            name="serviceChargePercent"
            type="text"
            inputMode="decimal"
            required
            defaultValue={bpToPercent(serviceChargeBp)}
            className="input h-12"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">Staff meal discount (%)</span>
          <input
            name="staffMealDiscountPercent"
            type="text"
            inputMode="decimal"
            required
            defaultValue={bpToPercent(staffMealDiscountBp)}
            className="input h-12"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">Currency</span>
          <select
            name="currency"
            defaultValue={currency}
            disabled={currencyLocked}
            className="input h-12 disabled:opacity-60"
          >
            {Object.keys(CURRENCIES).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          {currencyLocked ? (
            <span className="kicker">
              This branch has already taken payments, so the currency can&apos;t change — stored amounts are in units of the current currency.
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">Branch timezone (used to cut off the day for bill numbers/reports)</span>
          <input
            name="timezone"
            type="text"
            required
            defaultValue={timezone}
            className="input h-12"
          />
        </label>

        <label className="flex items-center gap-3 self-end pb-3">
          <input
            name="pricesIncludeVat"
            type="checkbox"
            defaultChecked={pricesIncludeVat}
            className="size-5"
          />
          <span>
            Menu prices already include VAT
            <span className="kicker block">
              Checked = VAT is extracted for display · Unchecked = VAT is added on top of the bill (different totals)
            </span>
          </span>
        </label>
      </div>

      {/* สกุลเงินที่ถูกล็อกไว้ยังต้องส่งค่าเดิมไปด้วย ไม่งั้น select ที่ disabled จะไม่ส่งอะไรเลย */}
      {currencyLocked ? <input type="hidden" name="currency" value={currency} /> : null}

      <Message state={state} />

      <SubmitButton pendingLabel="Saving..." className="btn btn-primary h-12">
        Save rates
      </SubmitButton>
    </form>
  );
}

export function BusinessInfoForm({
  tenantName,
  taxId,
  branchName,
  addressLine,
  phone,
  receiptFooter,
  disabledReason,
}: {
  tenantName: string;
  taxId: string | null;
  branchName: string;
  addressLine: string | null;
  phone: string | null;
  receiptFooter: string | null;
  disabledReason?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateBusinessInfoAction,
    IDLE_FORM_STATE,
  );

  if (disabledReason) {
    return <p className="kicker">{disabledReason}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="kicker">Business name (appears on receipts)</span>
          <input
            name="tenantName"
            type="text"
            required
            maxLength={120}
            defaultValue={tenantName}
            className="input h-12"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">Tax ID (13 digits)</span>
          <input
            name="taxId"
            type="text"
            inputMode="numeric"
            maxLength={20}
            defaultValue={taxId ?? ""}
            className="input h-12"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">Branch name</span>
          <input
            name="branchName"
            type="text"
            required
            maxLength={120}
            defaultValue={branchName}
            className="input h-12"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">Phone</span>
          <input
            name="phone"
            type="text"
            maxLength={40}
            defaultValue={phone ?? ""}
            className="input h-12"
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="kicker">Business address</span>
          <input
            name="addressLine"
            type="text"
            maxLength={200}
            defaultValue={addressLine ?? ""}
            className="input h-12"
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="kicker">Receipt footer text</span>
          <input
            name="receiptFooter"
            type="text"
            maxLength={200}
            placeholder="Thank you for your visit"
            defaultValue={receiptFooter ?? ""}
            className="input h-12"
          />
          <span className="kicker">
            Leave blank to use the default text · already-issued receipts keep the text as it was when printed.
          </span>
        </label>
      </div>

      <Message state={state} />

      <SubmitButton pendingLabel="Saving..." className="btn btn-primary h-12">
        Save business info
      </SubmitButton>
    </form>
  );
}

export function StationForm({
  station,
  disabled,
}: {
  station?: { id: string; code: string; name: string; sortOrder: number; isActive: boolean };
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    upsertStationAction,
    IDLE_FORM_STATE,
  );

  if (disabled) {
    return null;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 border-t-2 border-[var(--color-text)] pt-4">
      {station ? <input type="hidden" name="stationId" value={station.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="kicker">Code</span>
          <input
            name="code"
            type="text"
            required
            maxLength={12}
            defaultValue={station?.code ?? ""}
            className="input h-11"
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="kicker">Station name</span>
          <input
            name="name"
            type="text"
            required
            maxLength={60}
            defaultValue={station?.name ?? ""}
            className="input h-11"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">Sort order</span>
          <input
            name="sortOrder"
            type="number"
            required
            defaultValue={station?.sortOrder ?? 0}
            className="input h-11"
          />
        </label>
      </div>

      <label className="flex items-center gap-3">
        <input
          name="isActive"
          type="checkbox"
          defaultChecked={station?.isActive ?? true}
          className="size-5"
        />
        <span>Active (disabled stations don&apos;t appear on the kitchen display)</span>
      </label>

      <Message state={state} />

      <SubmitButton pendingLabel="Saving..." className="btn btn-secondary h-11">
        {station ? "Save station" : "Add station"}
      </SubmitButton>
    </form>
  );
}

/**
 * ปุ่มลบสถานี — ขึ้นเฉพาะสถานีที่ยังไม่เคยถูกใช้
 *
 * ตัวที่กันจริงคือ `deleteStation()` ฝั่ง server ที่นับ `OrderItem`/`MenuItem` ก่อนเสมอ
 * ที่นี่แค่ไม่วาดปุ่มเมื่อรู้อยู่แล้วว่ากดไปก็ไม่ผ่าน (การซ่อนปุ่มไม่ใช่การกันสิทธิ์)
 */
export function DeleteStationForm({ stationId }: { stationId: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    deleteStationAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="stationId" value={stationId} />

      <Message state={state} />

      <SubmitButton pendingLabel="Deleting..." className="btn btn-ghost h-9 text-[13px]">
        Delete station
      </SubmitButton>
    </form>
  );
}

/**
 * ── จุดขาย (โต๊ะ / เคาน์เตอร์ / ช่องไรเดอร์) ────────────────────────────────
 *
 * ก่อนมีฟอร์มนี้ การเพิ่มโต๊ะทำได้จาก `prisma/seed.ts` ที่เดียว
 *
 * **สามปุ่ม ไม่ใช่ปุ่มเดียว** เพราะเป็นการกระทำคนละชนิดกัน:
 *   - `TableForm`      แก้ข้อมูล (ย้อนกลับได้)
 *   - `RotateQrForm`   **เพิกถอน QR ใบเก่า** (ย้อนกลับไม่ได้ ต้องพิมพ์ใหม่)
 *   - `DeleteTableForm` ลบถาวร (ขึ้นเฉพาะตัวที่ไม่เคยถูกใช้)
 *
 * ท่าเดียวกับหน้าจัดการพนักงานในบทที่ 13b ที่แยก "แก้ข้อมูล" ออกจาก "รีเซ็ต PIN"
 */

const SALE_POINT_OPTIONS = [
  { value: "DINE_IN", label: "Dine-in table (shows on the table map)" },
  { value: "COUNTER", label: "Takeaway counter (queue number, no service charge)" },
  { value: "DELIVERY", label: "Delivery slot (queue number, no service charge)" },
] as const;

export function TableForm({
  table,
  disabled,
}: {
  table?: {
    id: string;
    name: string;
    seats: number;
    sortOrder: number;
    kind: string;
    isActive: boolean;
    /** มีประวัติขายแล้ว = ล็อกช่องชนิดจุดขาย (server ก็ปฏิเสธซ้ำอีกชั้น) */
    locked: boolean;
  };
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    upsertTableAction,
    IDLE_FORM_STATE,
  );

  if (disabled) {
    return null;
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-t-2 border-[var(--color-text)] pt-4"
    >
      {table ? <input type="hidden" name="tableId" value={table.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="kicker">Name</span>
          <input
            name="name"
            type="text"
            required
            maxLength={40}
            placeholder="e.g. A4"
            defaultValue={table?.name ?? ""}
            className="input h-11"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">Seats</span>
          <input
            name="seats"
            type="number"
            min={0}
            required
            defaultValue={table?.seats ?? 4}
            className="input h-11"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">Sort order</span>
          <input
            name="sortOrder"
            type="number"
            required
            defaultValue={table?.sortOrder ?? 0}
            className="input h-11"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="kicker">Type</span>
        <select
          name="kind"
          defaultValue={table?.kind ?? "DINE_IN"}
          disabled={table?.locked ?? false}
          className="input h-11"
        >
          {SALE_POINT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {table?.locked ? (
          <span className="kicker">
            Locked — this sale point already has sales history. Changing the type would rewrite what
            past bills meant (service charge, queue numbers). Create a new one instead.
          </span>
        ) : null}
      </label>

      <label className="flex items-center gap-3">
        <input
          name="isActive"
          type="checkbox"
          defaultChecked={table?.isActive ?? true}
          className="size-5"
        />
        <span>Active (disabled sale points don&apos;t appear on the POS)</span>
      </label>

      <Message state={state} />

      <SubmitButton pendingLabel="Saving..." className="btn btn-secondary h-11">
        {table ? "Save sale point" : "Add sale point"}
      </SubmitButton>
    </form>
  );
}

/**
 * ออก QR ใหม่ = ใบที่พิมพ์ไปแล้วใช้ไม่ได้ทันที
 *
 * `confirm()` เป็นแค่กัน "กดพลาด" ไม่ใช่การกันสิทธิ์ — ถ้า JS ไม่ทำงานมันจะถูกข้ามไป
 * ตัวที่กันจริงคือ `canEditSettings()` ฝั่ง server (ท่าเดียวกับปุ่มลบเมนูในโมดูล 04)
 */
export function RotateQrForm({ tableId, tableName }: { tableId: string; tableName: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    rotateTableCodeAction,
    IDLE_FORM_STATE,
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Issue a new QR code for ${tableName}?\n\nThe printed QR on that table stops working immediately and has to be reprinted.`,
          )
        ) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="tableId" value={tableId} />

      <Message state={state} />

      <SubmitButton pendingLabel="Issuing..." className="btn btn-ghost h-9 text-[13px]">
        New QR code
      </SubmitButton>
    </form>
  );
}

/**
 * ปุ่มลบ — ขึ้นเฉพาะจุดขายที่ไม่เคยถูกใช้เลย
 * ตัวที่กันจริงคือ `deleteTable()` ที่นับ `Order` **และ** `TableSession` ก่อนเสมอ
 */
export function DeleteTableForm({ tableId }: { tableId: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    deleteTableAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tableId" value={tableId} />

      <Message state={state} />

      <SubmitButton pendingLabel="Deleting..." className="btn btn-ghost h-9 text-[13px]">
        Delete
      </SubmitButton>
    </form>
  );
}
