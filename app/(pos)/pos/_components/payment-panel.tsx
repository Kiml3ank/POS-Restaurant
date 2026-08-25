"use client";

import { useActionState, useId, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import type { Currency } from "@/lib/generated/prisma/enums";
import { formatAmount, formatMoney, minorUnitsPerMajor, parseMoneyInput } from "@/lib/money";

import { takePaymentAction } from "../actions";

/**
 * ส่วนรับเงินของหน้าคิดเงิน (บทที่ 11 — โหมดสาธิต)
 *
 * ── สิ่งที่หน้าจอนี้ส่งไปให้ server มีแค่สองอย่าง ────────────────────────
 * "วิธีจ่าย" กับ "รับเงินสดมาเท่าไหร่" — **ยอดที่ต้องจ่ายไม่ได้ส่งไปเป็นข้อมูล**
 * (ที่ส่งไปด้วยคือ expectedTotal ซึ่ง server ใช้แค่เทียบว่าบิลเปลี่ยนไปหรือยัง
 * ไม่ได้ใช้เป็นยอด) ยอดจริงคิดใหม่ฝั่ง server ทุกครั้ง — ดู lib/server/payment.ts
 *
 * ── เงินทอนคิดสองที่โดยตั้งใจ ────────────────────────────────────────────
 * ที่นี่คิดเพื่อ "โชว์สด ๆ ระหว่างพิมพ์" ให้แคชเชียร์นับเงินทอนได้ก่อนกดยืนยัน
 * ส่วนตัวเลขที่บันทึกลง DB คิดใหม่ฝั่ง server เสมอ สองที่นี้ใช้สูตรเดียวกัน
 * (ลบจำนวนเต็มล้วน) และ **ห้ามเอาค่าจากที่นี่ไปเขียนลง DB**
 */
export function PaymentPanel({
  tableId,
  sessionId,
  currency,
  grandTotal,
  canTake,
}: {
  tableId: string;
  /** บิลใบไหน — จำเป็นเฉพาะจุดขายที่มีหลายบิลเปิดพร้อมกัน (เคาน์เตอร์ซื้อกลับ) */
  sessionId?: string;
  currency: Currency;
  grandTotal: number;
  /** false = ตำแหน่งนี้กดรับเงินไม่ได้ (ตัวกันจริงอยู่ฝั่ง server อีกชั้น) */
  canTake: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    takePaymentAction,
    IDLE_FORM_STATE,
  );

  const [method, setMethod] = useState<"CASH" | "QR">("CASH");
  const [cashText, setCashText] = useState("");
  const cashFieldId = useId();

  const received = parseMoneyInput(cashText, currency);
  const change = received === null ? null : received - grandTotal;

  if (!canTake) {
    return (
      <p className="alert" role="status">
        Your role can&apos;t take payments — please call a cashier or manager to close this bill
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tableId" value={tableId} />
            <input type="hidden" name="sessionId" value={sessionId ?? ""} />
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="expectedTotal" value={grandTotal} />
      {/*
        ส่งเป็นจำนวนเต็มหน่วยย่อยที่แปลงแล้ว ไม่ใช่ข้อความที่พนักงานพิมพ์
        — การแปลงเกิดที่ parseMoneyInput() ที่เดียว (lib/money.ts)
        และ server ตรวจซ้ำอีกรอบว่าเงินพอไหมก่อนปิดบิล
      */}
      {method === "CASH" && received !== null ? (
        <input type="hidden" name="receivedAmount" value={received} />
      ) : null}

      {/* ── เลือกวิธีจ่าย ─────────────────────────────────────────────── */}
      {/*
        ห้ามใส่ utility ที่ชนกับคลาสของ design system ตรงนี้ (`grid`, `hidden`, ฯลฯ)
        — `.pos-skin .ink-row` มี specificity 0-2-0 ซึ่งชนะ utility คลาสเดียวเสมอ
        แล้วจะได้ layout ที่ไม่ตรงกับคลาสที่เขียนไว้โดยไม่มีอะไรฟ้อง
        (กับดักเดียวกับใน archive/report/2026-08-22-responsive-screens.md §3.1)
        ที่นี่จึงแบ่งครึ่งด้วย flex-1 ที่ลูกแทน
      */}
      <div className="ink-row" role="group" aria-label="Payment method">
        <MethodButton
          label="Cash"
          active={method === "CASH"}
          onSelect={() => setMethod("CASH")}
        />
        <MethodButton label="QR" active={method === "QR"} onSelect={() => setMethod("QR")} />
      </div>

      {method === "CASH" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={cashFieldId} className="kicker">
            Cash received
          </label>
          <input
            id={cashFieldId}
            /*
              inputMode="decimal" ไม่ใช่ type="number" — type="number" บนมือถือ
              ยังโชว์ลูกศรขึ้นลงและกินค่าที่พิมพ์ผิดรูปแบบทิ้งเงียบ ๆ ที่นี่ต้องการ
              ให้ค่าที่พิมพ์อยู่ในช่องเสมอ แล้วเราตีความเองด้วย parseMoneyInput()
            */
            inputMode="decimal"
            autoComplete="off"
            value={cashText}
            onChange={(event) => setCashText(event.target.value)}
            placeholder={formatAmount(grandTotal, currency)}
            className="input display h-14 text-right text-[22px] tabular-nums"
          />

          <div className="flex flex-wrap gap-2">
            {quickAmounts(grandTotal, currency).map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => setCashText(formatAmount(amount, currency))}
                className="btn btn-secondary h-10 px-3 text-[13px] tabular-nums"
              >
                {formatMoney(amount, currency)}
              </button>
            ))}
          </div>

          {/* เงินทอนต้องใหญ่และอ่านได้จากระยะที่ลูกค้ายืนอยู่ — เป็นตัวเลขที่ทั้งสองฝ่ายต้องเห็นตรงกัน */}
          <div className="flex items-baseline justify-between gap-3 border-t-2 border-[var(--color-text)] pt-3">
            <span className="kicker">Change</span>
            <span className="display text-[26px] tabular-nums">
              {change === null ? "—" : change < 0 ? "Not enough" : formatMoney(change, currency)}
            </span>
          </div>
        </div>
      ) : (
        <QrPlaceholder amount={grandTotal} currency={currency} />
      )}

      {state.status === "error" ? (
        <p role="alert" className="alert">
          {state.message}
        </p>
      ) : null}

      <SubmitButton
        pendingLabel="Closing bill…"
        className="btn btn-primary btn-block display h-14 text-[17px]"
        disabled={method === "CASH" && (received === null || received < grandTotal)}
      >
        Confirm payment of {formatMoney(grandTotal, currency)}
      </SubmitButton>
    </form>
  );
}

function MethodButton({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`btn display h-12 flex-1 text-[15px] ${active ? "is-active" : "btn-secondary"}`}
    >
      {label}
    </button>
  );
}

/**
 * กล่อง QR ของโหมดสาธิต
 *
 * **ตั้งใจไม่วาดให้เหมือน QR จริง** (ไม่มีสี่เหลี่ยม finder ตามมุม) เพราะถ้าวาด
 * ให้เหมือนของจริง จะมีคนยกมือถือขึ้นมาสแกนแล้วสงสัยว่าเครื่องเสีย — ของปลอม
 * ที่ดูออกว่าปลอมตั้งแต่แรกเห็น ปลอดภัยกว่าของปลอมที่เนียน
 *
 * ของจริงต้องเป็น payload ตามมาตรฐาน EMVCo ของแต่ละประเทศ (ไทย = PromptPay
 * tag 29 · ลาว = LAO QR ของ BCEL One · เวียดนาม = VietQR ของ NAPAS) และต้อง
 * รอ callback จากธนาคารก่อนปิดบิล ไม่ใช่ให้แคชเชียร์กดยืนยันเอง
 */
function QrPlaceholder({ amount, currency }: { amount: number; currency: Currency }) {
  return (
    <div className="flex flex-col items-center gap-3 border-2 border-dashed border-[var(--color-text)] p-5 text-center">
      <span className="tag tag-accent">Demo mode · not a real scannable code</span>

      <div
        aria-hidden
        className="flex h-32 w-32 items-center justify-center border-2 border-[var(--color-neutral-500)] bg-[var(--color-neutral-200)]"
      >
        <span className="display text-[30px] text-[var(--color-neutral-600)]">QR</span>
      </div>

      <p className="display text-[22px] tabular-nums">{formatMoney(amount, currency)}</p>
      <p className="text-[13px] text-[var(--color-neutral-700)]">
        Not connected to a bank yet — only confirm once payment has actually been received.
      </p>
    </div>
  );
}

/**
 * ปุ่มลัด "ยอดกลม ๆ" ที่ลูกค้ามักยื่นมาให้
 *
 * ขนาดของ "ยอดกลม" ต่างกันตามสกุลเงินมาก (พันบาท กับ แสนดอง คนละสเกล) จึงคิด
 * จากจำนวนหลักของยอดจริงแทนการ hardcode ค่าแบงก์ของประเทศใดประเทศหนึ่ง:
 * ปัดขึ้นเป็นหลักถัดไป แล้วขยับเป็น 5 เท่าและ 10 เท่าของหลักนั้น
 *
 * ทุกขั้นตอนเป็นจำนวนเต็มล้วน (ยกกำลังสิบด้วยการวนคูณ ไม่ใช่ Math.pow ที่คืน float)
 * และตัดค่าที่ซ้ำ/เท่ากับยอดพอดีออก เพราะปุ่ม "พอดี" มีอยู่แล้วเป็นปุ่มแรก
 */
function quickAmounts(grandTotal: number, currency: Currency): number[] {
  if (grandTotal <= 0) {
    return [];
  }

  const perMajor = minorUnitsPerMajor(currency);
  const major = Math.floor(grandTotal / perMajor);
  const digits = String(Math.max(major, 1)).length;

  let step = 1;
  for (let index = 0; index < Math.max(digits - 2, 0); index += 1) {
    step *= 10;
  }

  const roundUpTo = (unit: number) => {
    const size = unit * perMajor;
    const remainder = grandTotal % size;

    return remainder === 0 ? grandTotal : grandTotal + (size - remainder);
  };

  const candidates = [grandTotal, roundUpTo(step), roundUpTo(step * 5), roundUpTo(step * 10)];

  return [...new Set(candidates)].sort((a, b) => a - b).slice(0, 4);
}
