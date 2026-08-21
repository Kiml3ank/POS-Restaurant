"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";

import { loginAction } from "../actions";

/**
 * ล็อกอินพนักงานด้วยรหัส + PIN (บทที่ 13 ส่วนที่ POS บทที่ 9 ต้องใช้ก่อน)
 *
 * ทำเป็นแป้นตัวเลขเต็มจอ ไม่ใช่ช่อง input ธรรมดา เพราะเครื่อง POS เป็นจอสัมผัส
 * ที่ไม่มีคีย์บอร์ด และพนักงานต้องสลับคนกันกดวันละหลายสิบครั้ง ปุ่มจึงต้องใหญ่
 * พอกดด้วยนิ้วโป้งได้โดยไม่ต้องมอง
 *
 * PIN ไม่เคยถูกส่งไปไหนนอกจากตอน submit และไม่โชว์ตัวเลขจริงบนจอ (แสดงเป็นจุด)
 * เพราะจอ POS อยู่ในที่ที่ลูกค้ามองเห็น
 *
 * หน้าตาตาม design "Cafe POS": ช่อง PIN เป็นกล่องขอบ 2px เรียงกัน และแป้นตัวเลข
 * อยู่บนกริดเส้นหมึก (.ink-grid) ไม่ใช่ปุ่มมนแยกชิ้น
 */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * PIN ยาว 4-6 หลัก (ตาม CLAUDE.md หัวข้อ 2) — ช่องจึงมี 6 ช่องแต่กดส่งได้ตั้งแต่ 4
 *
 * ตอนแรกวาดทั้ง 6 ช่องเหมือนกันหมด แล้วอ่านออกมาเป็น "ต้องกรอกให้ครบ 6 หลัก"
 * ทั้งที่ PIN ของ seed ยาว 4 หลัก คนกดเลยค้างรอว่าจะกรอกอะไรอีกสองตัว
 * สองช่องท้ายจึงใช้เส้นขอบจาง ๆ เพื่อบอกว่า "มีก็ได้ ไม่มีก็ได้"
 */
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 6;

export function PinForm() {
  const [state, formAction] = useActionState<FormState, FormData>(loginAction, IDLE_FORM_STATE);
  const [staffCode, setStaffCode] = useState("");
  const [pin, setPin] = useState("");

  return (
    <form action={formAction} className="flex w-full flex-col gap-7">
      <input type="hidden" name="pin" value={pin} />

      <div className="flex flex-col gap-3">
        <label htmlFor="staffCode" className="kicker">
          รหัสพนักงาน
        </label>
        <input
          id="staffCode"
          name="staffCode"
          inputMode="numeric"
          autoComplete="off"
          value={staffCode}
          onChange={(event) => setStaffCode(event.target.value.trim())}
          placeholder="เช่น 001"
          className="input display h-16 text-center text-[26px] tracking-[0.3em]"
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="kicker">PIN</span>
          <span className="kicker">
            {pin.length < MIN_PIN_LENGTH
              ? `อย่างน้อย ${MIN_PIN_LENGTH} หลัก`
              : `${pin.length} หลัก · กดเริ่มกะได้เลย`}
          </span>
        </div>

        <div
          aria-live="polite"
          aria-label={`กรอก PIN แล้ว ${pin.length} หลัก จากอย่างน้อย ${MIN_PIN_LENGTH} หลัก`}
          className="flex gap-2"
        >
          {Array.from({ length: MAX_PIN_LENGTH }, (_, index) => {
            const filled = index < pin.length;
            const isNext = index === pin.length;
            // สองช่องท้ายเป็นส่วนเกินของ PIN 4 หลัก — เส้นจางลงเพื่อไม่ให้อ่านว่า "ต้องกรอก"
            const optional = index >= MIN_PIN_LENGTH && !filled;

            return (
              <span
                key={index}
                className={`flex h-16 flex-1 items-center justify-center border-2 text-[30px] leading-none ${
                  optional ? "border-[var(--color-neutral-400)]" : "border-[var(--color-text)]"
                } ${isNext ? "bg-[var(--color-accent-100)]" : "bg-[var(--color-bg)]"}`}
              >
                {filled ? "•" : ""}
              </span>
            );
          })}
        </div>
      </div>

      <div className="ink-grid grid-cols-3">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPin((current) => (current + key).slice(0, MAX_PIN_LENGTH))}
            className="btn-tile py-6 text-[26px]"
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPin("")}
          className="btn-tile py-6 text-[17px]"
        >
          ล้าง
        </button>
        <button
          type="button"
          onClick={() => setPin((current) => (current + "0").slice(0, MAX_PIN_LENGTH))}
          className="btn-tile py-6 text-[26px]"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => setPin((current) => current.slice(0, -1))}
          aria-label="ลบหนึ่งหลัก"
          className="btn-tile py-6 text-[26px]"
        >
          ⌫
        </button>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="alert">
          {state.message}
        </p>
      ) : null}

      <SubmitButton
        pendingLabel="กำลังตรวจสอบ..."
        disabled={staffCode.length === 0 || pin.length < MIN_PIN_LENGTH}
        className="btn btn-primary btn-block h-16 text-lg"
      >
        เริ่มกะ
      </SubmitButton>
    </form>
  );
}
