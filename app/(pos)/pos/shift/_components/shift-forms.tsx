"use client";

import { useActionState } from "react";

import { useT } from "@/components/i18n-provider";
import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";

import { closeShiftAction, openShiftAction } from "../../actions";

/** เปิดกะ — ช่องเดียวคือเงินทอนตั้งต้นที่นับใส่ลิ้นชักไว้ก่อนเริ่มขาย */
export function OpenShiftForm() {
  const [state, formAction] = useActionState<FormState, FormData>(
    openShiftAction,
    IDLE_FORM_STATE,
  );

  const { t } = useT();

  return (
    <form action={formAction} className="panel flex flex-col gap-3 p-6">
      <label className="flex flex-col gap-1">
        <span className="kicker">{t("pos.shift.openingFloatLabel")}</span>
        <input
          name="openingFloat"
          type="text"
          inputMode="decimal"
          required
          placeholder={t("pos.shift.openingFloatPlaceholder")}
          className="input display h-14 text-[18px]"
        />
      </label>

      {state.status === "error" ? (
        <p role="alert" className="alert">
          {t(state.messageKey, state.params)}
        </p>
      ) : null}

      <SubmitButton
        pendingLabel={t("pos.shift.openPending")}
        className="btn btn-primary h-14 text-base"
      >
        {t("pos.shift.openButton")}
      </SubmitButton>
    </form>
  );
}

/**
 * ปิดกะ — ซ่อนใน <details> เพราะเป็นปุ่มที่กดพลาดแล้วต้องเปิดกะใหม่ทั้งกะ
 * และแสดง "ระบบว่าควรมีเท่าไร" ไว้ข้าง ๆ ช่องกรอกเสมอ
 */
export function CloseShiftForm({
  shiftId,
  expectedLabel,
}: {
  shiftId: string;
  /** ยอดที่ระบบคำนวณ จัดรูปมาแล้วจากฝั่ง server (formatMoney ต้องใช้สกุลของสาขา) */
  expectedLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    closeShiftAction,
    IDLE_FORM_STATE,
  );

  const { t } = useT();

  return (
    <details className="panel p-6">
      <summary className="kicker cursor-pointer">{t("pos.shift.closeTitle")}</summary>

      <form action={formAction} className="flex flex-col gap-3 pt-4">
        <input type="hidden" name="shiftId" value={shiftId} />

        <p className="text-[15px]">{t("pos.shift.expectedLine", { amount: expectedLabel })}</p>

        <label className="flex flex-col gap-1">
          <span className="kicker">{t("pos.shift.countedLabel")}</span>
          <input
            name="countedCash"
            type="text"
            inputMode="decimal"
            required
            className="input display h-14 text-[18px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">{t("pos.shift.noteLabel")}</span>
          <input
            name="note"
            type="text"
            maxLength={200}
            placeholder={t("pos.shift.notePlaceholder")}
            className="input h-12"
          />
        </label>

        {state.status === "error" ? (
          <p role="alert" className="alert">
            {t(state.messageKey, state.params)}
          </p>
        ) : null}

        <SubmitButton
          pendingLabel={t("pos.shift.closePending")}
          className="btn btn-primary h-14 text-base"
        >
          {t("pos.shift.closeButton")}
        </SubmitButton>
      </form>
    </details>
  );
}
