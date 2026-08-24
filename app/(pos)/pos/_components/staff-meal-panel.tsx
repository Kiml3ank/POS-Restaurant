"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE } from "@/lib/form-state";

import { clearStaffMealAction, setStaffMealAction } from "../actions";

/**
 * ติด/ปลดธง "บิลนี้พนักงานกิน" (บทที่ 13)
 *
 * ── ทำไมเป็นช่องเลือกคน ไม่ใช่สวิตช์เปิด-ปิด ────────────────────────────
 * สวิตช์ตอบได้แค่ "บิลนี้มีส่วนลด" ซึ่งเป็นข้อมูลที่ไร้ประโยชน์ตอนตรวจสอบ
 * สิ่งที่ต้องตอบให้ได้คือ **ใครกิน** — เพราะรูปแบบโกงคือติดธงทุกบิลแล้วเก็บส่วนต่าง
 * และมันดูปกติมากถ้าดูทีละใบ ชื่อคนที่ติดอยู่ถาวรคือสิ่งเดียวที่ทำให้มองเห็นรูปแบบ
 *
 * **คนกดกับคนกินเป็นคนละคนได้** และนั่นคือเคสปกติ (แคชเชียร์คิดเงินให้พ่อครัว)
 * — server บันทึกทั้งสอง id ไม่ใช่แค่ id เดียว
 *
 * ── สองฟอร์มแยกกัน ไม่ใช่ฟอร์มเดียวที่มีสองปุ่ม ─────────────────────────
 * เพราะ `useActionState` ผูกกับหนึ่ง action และ `useFormStatus` ใน SubmitButton
 * อ่านสถานะจาก `<form>` ที่ครอบตัวเองเท่านั้น — รวมเป็นฟอร์มเดียวแล้วปุ่มทั้งสอง
 * จะขึ้น "กำลังบันทึก" พร้อมกันทั้งที่กดไปแค่ปุ่มเดียว
 */
export function StaffMealPanel({
  tableId,
  sessionId,
  staffOptions,
  currentStaffCustomer,
  discountLabel,
  canEdit,
}: {
  tableId: string;
  /** บิลใบไหน — จำเป็นเฉพาะจุดขายที่มีหลายบิลเปิดพร้อมกัน (เคาน์เตอร์ซื้อกลับ) */
  sessionId?: string;
  staffOptions: Array<{ id: string; name: string; code: string }>;
  currentStaffCustomer: { id: string; name: string; code: string } | null;
  /** เช่น "10%" — มาจาก Branch ไม่ใช่จากหน้าจอ */
  discountLabel: string;
  canEdit: boolean;
}) {
  const [setState, setAction] = useActionState(setStaffMealAction, IDLE_FORM_STATE);
  const [clearState, clearAction] = useActionState(clearStaffMealAction, IDLE_FORM_STATE);

  const error =
    setState.status === "error"
      ? setState.message
      : clearState.status === "error"
        ? clearState.message
        : null;

  if (currentStaffCustomer) {
    return (
      <div className="flex flex-col gap-2 border-2 border-[var(--color-accent)] bg-[var(--color-accent-100)] p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="kicker kicker-accent">ส่วนลดพนักงาน {discountLabel}</span>
        </div>
        <span className="display text-[15px]">
          {currentStaffCustomer.name}
          <span className="kicker ml-2">#{currentStaffCustomer.code}</span>
        </span>

        {canEdit ? (
          <form action={clearAction}>
            <input type="hidden" name="tableId" value={tableId} />
            <input type="hidden" name="sessionId" value={sessionId ?? ""} />
            <SubmitButton pendingLabel="กำลังปลด…" className="btn btn-secondary h-9 w-full text-[13px]">
              ปลดธง (คิดราคาเต็ม)
            </SubmitButton>
          </form>
        ) : null}

        {error ? (
          <p role="alert" className="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (!canEdit) {
    return null;
  }

  /**
   * สถานะ "ยังไม่ติดธง" ตั้งใจให้เตี้ยที่สุด — ช่องเลือกกับปุ่มอยู่แถวเดียวกัน
   * ไม่มีกรอบ ไม่มีหัวข้อแยกบรรทัด
   *
   * เพราะแผงนี้อยู่ในโซนเดียวกับยอดเงิน ทุก pixel ที่มันกินคือ pixel ที่ยอดรวม
   * เสียไป และมันเป็นของที่ **ไม่ได้ใช้ทุกบิล** (บิลส่วนใหญ่เป็นลูกค้าจริง)
   * ของที่ใช้นาน ๆ ครั้งไม่ควรกินที่เท่าของที่ใช้ทุกครั้ง
   */
  return (
    <form action={setAction} className="flex flex-col gap-1.5">
      {/*
        ── ถ้อยคำต้องเป็น "คำถาม" ไม่ใช่ "ยอด" ──────────────────────────────
        รอบแรกเขียนหัวข้อว่า "ส่วนลดพนักงาน 10%" ซึ่งอยู่ต่อจากแถว
        ค่าอาหาร / เซอร์วิสชาร์จ / VAT พอดี — คนอ่านจึงเข้าใจว่า **บิลนี้ถูกลด 10%
        ไปแล้ว** ทั้งที่มันคือช่องให้เลือกว่าจะลดหรือไม่ (ผู้ใช้รายงานเข้ามาจริง)

        แถวยอดเงินทุกแถวในแพเนลนี้เป็นรูปแบบ "ป้าย ... จำนวนเงิน" การเอาหัวข้อ
        ที่หน้าตาเหมือนป้ายมาวางต่อท้ายจึงถูกอ่านเป็นแถวยอดเงินโดยอัตโนมัติ
        — ประโยคคำถามอ่านผิดแบบนั้นไม่ได้
      */}
      <span className="kicker">บิลนี้พนักงานกินหรือเปล่า</span>
      <input type="hidden" name="tableId" value={tableId} />
            <input type="hidden" name="sessionId" value={sessionId ?? ""} />

      <div className="flex items-stretch gap-2">
        {/*
          ค่าเริ่มต้นเป็นค่าว่างเสมอ **ห้ามเลือกคนแรกไว้ให้** — ปุ่มที่กดพลาดครั้งเดียว
          แล้วได้ส่วนลดพร้อมชื่อคนที่ไม่ได้กิน คือสิ่งที่ทั้งเสียเงินและเสียหลักฐาน
        */}
        <select
          name="staffCustomerId"
          required
          defaultValue=""
          aria-label="พนักงานที่กิน"
          className="input h-9 min-w-0 flex-1 text-[13px]"
        >
          <option value="" disabled>
            เลือกพนักงานที่กิน…
          </option>
          {staffOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.code} · {option.name}
            </option>
          ))}
        </select>

        {/* เปอร์เซ็นต์อยู่บน "ปุ่ม" ไม่ใช่บนหัวข้อ — บอกว่ากดแล้วจะเกิดอะไร ไม่ใช่บอกว่าเกิดไปแล้ว */}
        <SubmitButton
          pendingLabel="กำลังบันทึก…"
          className="btn btn-secondary h-9 flex-none px-3 text-[13px] whitespace-nowrap"
        >
          ลด {discountLabel}
        </SubmitButton>
      </div>

      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
