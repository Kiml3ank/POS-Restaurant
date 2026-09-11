"use client";

import { useT } from "@/components/i18n-provider";
import { useActionState } from "react";

import { openTableSessionAction } from "../actions";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { SubmitButton } from "@/components/submit-button";

/**
 * หน้าจอแรกที่ลูกค้าเห็นหลังสแกน QR (บทที่ 5)
 *
 * ต้องมีขั้นนี้คั่นก่อนเข้าเมนู เพราะ tableCode ใน QR ไม่มีวันหมดอายุ
 * แต่ "รอบโต๊ะ" มี — การกดปุ่มนี้คือจุดที่ระบบออก TableSession + cookie ให้
 * และเป็นจังหวะเดียวที่เหมาะจะถามจำนวนลูกค้า (ใช้ทำยอดขายต่อหัวในบทที่ 15)
 */
const PAX_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

export function OpenSessionForm({
  tableCode,
  tableName,
  defaultPax,
}: {
  tableCode: string;
  tableName: string;
  defaultPax: number;
}) {
  const { t, tc } = useT();
  const [state, formAction] = useActionState<FormState, FormData>(
    openTableSessionAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="tableCode" value={tableCode} />

      <div className="flex flex-col gap-2">
        <label htmlFor="pax" className="text-sm font-medium">
          {t("customer.open.guestsLabel")}
        </label>
        <select
          id="pax"
          name="pax"
          defaultValue={defaultPax}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-3 text-base"
        >
          {PAX_OPTIONS.map((pax) => (
            <option key={pax} value={pax}>
              {tc("common.guests", pax)}
            </option>
          ))}
        </select>
        <p className="text-xs text-neutral-500">{t("customer.open.joinHint", { name: tableName })}</p>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {t(state.messageKey, state.params)}
        </p>
      ) : null}

      <SubmitButton
        pendingLabel={t("common.openingTable")}
        className="rounded-lg bg-neutral-900 px-4 py-3 text-center font-medium text-white"
      >
        {t("customer.open.submit")}
      </SubmitButton>
    </form>
  );
}
