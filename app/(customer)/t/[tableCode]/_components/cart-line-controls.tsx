"use client";

import { useT } from "@/components/i18n-provider";
import { useActionState } from "react";

import { setCartLineQuantityAction } from "../actions";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { SubmitButton } from "@/components/submit-button";

/**
 * ปุ่มเพิ่ม/ลด/ลบ ของหนึ่งบรรทัดในตะกร้า (บทที่ 7)
 *
 * ทุกปุ่มเป็น <form> ของตัวเองที่ยิง Server Action ตัวเดียวกัน ต่างกันแค่ค่า
 * quantity ที่ส่งไป (0 = ลบบรรทัดนั้น) ทำแบบนี้เพื่อให้ยังกดได้แม้ JS ยังโหลด
 * ไม่เสร็จ — ลูกค้าบนเน็ตมือถืออ่อน ๆ กดได้ทันทีที่ HTML มาถึง
 *
 * จำนวนจริงอยู่ใน DB ฝั่ง server เท่านั้น component นี้ไม่มี state ของตัวเอง
 * เลยไม่มีทางที่ตัวเลขบนจอกับตัวเลขในบิลจะไม่ตรงกัน
 */
export function CartLineControls({
  tableCode,
  orderItemId,
  quantity,
}: {
  tableCode: string;
  orderItemId: string;
  quantity: number;
}) {
  const { t } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    setCartLineQuantityAction,
    IDLE_FORM_STATE,
  );

  const roundButton =
    "flex size-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-lg leading-none";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <form action={formAction}>
          <input type="hidden" name="tableCode" value={tableCode} />
          <input type="hidden" name="orderItemId" value={orderItemId} />
          <input type="hidden" name="quantity" value={quantity - 1} />
          <SubmitButton
            pendingLabel="…"
            className={quantity === 1 ? `${roundButton} text-xs` : roundButton}
          >
            {quantity === 1 ? t("customer.cart.remove") : "−"}
          </SubmitButton>
        </form>

        <span className="w-6 text-center font-medium">{quantity}</span>

        <form action={formAction}>
          <input type="hidden" name="tableCode" value={tableCode} />
          <input type="hidden" name="orderItemId" value={orderItemId} />
          <input type="hidden" name="quantity" value={quantity + 1} />
          <SubmitButton pendingLabel="…" className={roundButton} disabled={quantity >= 99}>
            +
          </SubmitButton>
        </form>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-xs text-red-700">
          {t(state.messageKey, state.params)}
        </p>
      ) : null}
    </div>
  );
}
