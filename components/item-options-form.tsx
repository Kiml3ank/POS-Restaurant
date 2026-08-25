"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import type { Currency } from "@/lib/generated/prisma/enums";
import { formatMoney, formatMoneyDelta, lineTotalOf } from "@/lib/money";

/**
 * ฟอร์มเลือกตัวเลือก + จำนวน ก่อนใส่ตะกร้า (บทที่ 6-7 และใช้ซ้ำที่ POS บทที่ 9)
 *
 * นี่คือจุดเดียวของหน้าจอลูกค้าที่ "ต้อง" เป็น client component จริง ๆ เพราะ
 * ราคาต้องขยับตามตัวเลือกที่กดทันทีโดยไม่ยิงกลับ server ทุกครั้ง
 * ส่วนที่เหลือ (รายการเมนู หมวด ราคาเริ่มต้น) เป็น Server Component ทั้งหมด
 *
 * กฎการเลือกไม่ได้ hardcode ไว้ในนี้ — มาจาก required/minSelect/maxSelect
 * ของ ModifierGroup ใน DB ทั้งหมด และถูกตรวจซ้ำอีกรอบฝั่ง server เสมอ
 *
 * รับ Server Action มาเป็น prop เพื่อให้หน้าลูกค้ากับหน้า POS ใช้ฟอร์มตัวเดียวกัน
 * ได้ทั้งที่ยิงไปคนละ action (คนละด่านตรวจสิทธิ์) — Next.js อนุญาตให้ส่ง action
 * เป็น prop ลง client component ได้ตรง ๆ
 *
 * `skin` แยกเฉพาะ "หน้าตา" ไม่แตะตรรกะสักบรรทัด: ค่าเริ่มต้น `default` คือลุค
 * มือถือของลูกค้า (รายการแนวตั้ง กดง่ายด้วยนิ้วโป้งมือเดียว) ส่วน `pos` คือลุค
 * design system Modernist ของจอพนักงาน (ตัวเลือกเป็นแถบ segmented บนกริดเส้นหมึก
 * กวาดสายตาทีเดียวเห็นครบ) — จอสองจอนี้ใช้งานคนละท่ากันจริง ๆ จึงไม่ควรบังคับ
 * ให้หน้าตาเหมือนกัน แต่กฎการเลือกต้องเป็นโค้ดชุดเดียวกันเป๊ะ
 */

export type OptionGroupView = {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  modifiers: { id: string; name: string; priceDelta: number }[];
};

export function ItemOptionsForm({
  action,
  hiddenFields,
  basePrice,
  groups,
  currency,
  submitLabel = "Add to cart",
  skin = "default",
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** ค่าที่ต้องติดไปกับฟอร์มเสมอ เช่น tableCode ของลูกค้า หรือ tableId ของ POS */
  hiddenFields: Record<string, string>;
  basePrice: number;
  groups: OptionGroupView[];
  /** สกุลเงินของสาขา — ต้องส่งมาเสมอ ห้ามเดาเป็นบาท (ดู lib/money.ts) */
  currency: Currency;
  submitLabel?: string;
  skin?: "default" | "pos";
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, IDLE_FORM_STATE);
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  const isPos = skin === "pos";
  const pickedIn = (groupId: string) => selected[groupId] ?? [];

  function toggle(group: OptionGroupView, modifierId: string) {
    setSelected((current) => {
      const picked = current[group.id] ?? [];

      // maxSelect = 1 ทำตัวเป็น radio: เลือกใหม่ทับของเดิมเสมอ
      if (group.maxSelect === 1) {
        return { ...current, [group.id]: [modifierId] };
      }

      if (picked.includes(modifierId)) {
        return { ...current, [group.id]: picked.filter((id) => id !== modifierId) };
      }

      if (picked.length >= group.maxSelect) {
        return current;
      }

      return { ...current, [group.id]: [...picked, modifierId] };
    });
  }

  const modifierTotal = groups.reduce((sum, group) => {
    const picked = pickedIn(group.id);
    return (
      sum +
      group.modifiers
        .filter((modifier) => picked.includes(modifier.id))
        .reduce((groupSum, modifier) => groupSum + modifier.priceDelta, 0)
    );
  }, 0);

  // กฎเดียวกับที่ addToCart() ตรวจฝั่ง server — ที่นี่แค่ทำให้ปุ่มกดไม่ได้ก่อน
  const missingRequired = groups.filter((group) => {
    const count = pickedIn(group.id).length;
    const minimum = group.required ? Math.max(group.minSelect, 1) : group.minSelect;
    return count < minimum;
  });

  const total = lineTotalOf(basePrice, modifierTotal, quantity);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="quantity" value={quantity} />
      {groups.flatMap((group) =>
        pickedIn(group.id).map((modifierId) => (
          <input key={modifierId} type="hidden" name="modifierId" value={modifierId} />
        )),
      )}

      {groups.map((group) => {
        const picked = pickedIn(group.id);
        const atLimit = group.maxSelect > 1 && picked.length >= group.maxSelect;
        const hint =
          group.required || group.minSelect > 0
            ? "Required"
            : `Choose up to ${group.maxSelect}`;

        return (
          <fieldset key={group.id} className="flex flex-col gap-3">
            <legend className="flex w-full items-baseline justify-between pb-2">
              <span className={isPos ? "kicker" : "font-medium"}>{group.name}</span>
              <span className={isPos ? "kicker" : "text-xs text-neutral-500"}>{hint}</span>
            </legend>

            <div className={isPos ? "ink-row flex-wrap" : "flex flex-col gap-1"}>
              {group.modifiers.map((modifier) => {
                const isPicked = picked.includes(modifier.id);
                const isBlocked = atLimit && !isPicked;

                return (
                  <label
                    key={modifier.id}
                    className={
                      isPos
                        ? `flex min-w-[104px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-3 py-3.5 text-center transition-colors ${
                            isPicked
                              ? "bg-[var(--color-accent)] text-white"
                              : "bg-[var(--color-bg)] hover:bg-[var(--color-accent-100)]"
                          } ${isBlocked ? "cursor-not-allowed opacity-40" : ""}`
                        : `flex items-center gap-3 rounded-lg border px-3 py-3 text-sm ${
                            isPicked
                              ? "border-neutral-900 bg-neutral-50"
                              : "border-neutral-200 bg-white"
                          } ${isBlocked ? "opacity-50" : ""}`
                    }
                  >
                    <input
                      type={group.maxSelect === 1 ? "radio" : "checkbox"}
                      name={`group-${group.id}`}
                      checked={isPicked}
                      disabled={isBlocked}
                      onChange={() => toggle(group, modifier.id)}
                      className={isPos ? "sr-only" : "size-4 accent-neutral-900"}
                    />

                    {isPos ? (
                      <>
                        <span className="font-bold">{modifier.name}</span>
                        {modifier.priceDelta !== 0 ? (
                          <span className="text-[11px] opacity-80">
                            {formatMoneyDelta(modifier.priceDelta, currency)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="flex-1">{modifier.name}</span>
                        <span className="text-neutral-500">
                          {formatMoneyDelta(modifier.priceDelta, currency)}
                        </span>
                      </>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-col gap-3">
        <label htmlFor="note" className={isPos ? "kicker" : "font-medium"}>
          Note to kitchen
        </label>
        <input
          id="note"
          name="note"
          type="text"
          maxLength={200}
          placeholder="e.g. no cilantro"
          className={
            isPos
              ? "input h-12"
              : "w-full rounded-lg border border-neutral-300 px-3 py-3 text-base"
          }
        />
      </div>

      <div className="flex items-center justify-between">
        <span className={isPos ? "kicker" : "font-medium"}>Quantity</span>

        {isPos ? (
          <div className="stepper h-12 w-40">
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              aria-label="Decrease quantity"
              className="flex-1"
            >
              −
            </button>
            <span aria-live="polite" className="stepper-value flex-1">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.min(99, current + 1))}
              aria-label="Increase quantity"
              className="flex-1"
            >
              +
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              aria-label="Decrease quantity"
              className="size-11 rounded-full border border-neutral-300 text-xl leading-none"
            >
              −
            </button>
            <span aria-live="polite" className="w-8 text-center text-lg font-medium">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.min(99, current + 1))}
              aria-label="Increase quantity"
              className="size-11 rounded-full border border-neutral-300 text-xl leading-none"
            >
              +
            </button>
          </div>
        )}
      </div>

      {state.status === "error" ? (
        <p
          role="alert"
          className={isPos ? "alert" : "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"}
        >
          {state.message}
        </p>
      ) : null}

      {missingRequired.length > 0 ? (
        <p className={isPos ? "kicker" : "text-sm text-neutral-500"}>
          ยังต้องเลือก: {missingRequired.map((group) => group.name).join(", ")}
        </p>
      ) : null}

      <SubmitButton
        pendingLabel="Adding to cart..."
        disabled={missingRequired.length > 0}
        className={
          isPos
            ? "btn btn-primary btn-block h-[52px] text-base"
            : "rounded-lg bg-neutral-900 px-4 py-3 text-center font-medium text-white"
        }
      >
        {submitLabel} · {formatMoney(total, currency)}
      </SubmitButton>
    </form>
  );
}
