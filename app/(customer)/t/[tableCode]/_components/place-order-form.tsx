"use client";

import { useT } from "@/components/i18n-provider";
import { useActionState } from "react";

import type { Currency } from "@/lib/generated/prisma/enums";
import { formatMoney } from "@/lib/money";

import { placeOrderAction } from "../actions";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { SubmitButton } from "@/components/submit-button";

/**
 * ปุ่มส่งออร์เดอร์เข้าครัว (บทที่ 7)
 *
 * ชั้นกันกดซ้ำที่หน้าจอ = ปุ่มปิดตัวเองทันทีที่กด (useFormStatus ใน SubmitButton)
 * ชั้นกันกดซ้ำที่เชื่อถือได้จริง = conditional update DRAFT → PLACED ใน placeOrder()
 * ต้องมีทั้งสองชั้น เพราะชั้นบนกัน "กดรัว" ซึ่งเจอบ่อยสุด ส่วนชั้นล่างกันกรณีที่
 * ไม่ผ่านหน้าจอเราเลย
 */
export function PlaceOrderForm({
  tableCode,
  subtotal,
  itemCount,
  currency,
}: {
  tableCode: string;
  subtotal: number;
  itemCount: number;
  currency: Currency;
}) {
  const { t, tc } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    placeOrderAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tableCode" value={tableCode} />

      {state.status === "error" ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {t(state.messageKey, state.params)}
        </p>
      ) : null}

      <SubmitButton
        pendingLabel={t("common.sendingToKitchen")}
        disabled={itemCount === 0}
        className="rounded-lg bg-neutral-900 px-4 py-4 text-center text-base font-medium text-white"
      >
        {tc("customer.place.submit", itemCount, { total: formatMoney(subtotal, currency) })}
      </SubmitButton>

      <p className="text-center text-xs text-neutral-500">{t("customer.place.hint")}</p>
    </form>
  );
}
