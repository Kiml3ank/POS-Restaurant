"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import type { LastStaffOnDevice } from "@/lib/last-staff-cookie";
import { STAFF_ROLE_LABEL } from "@/lib/rbac";
import type { StaffRole } from "@/lib/generated/prisma/enums";

/**
 * ล็อกอินพนักงานด้วยรหัส + PIN (บทที่ 13 ส่วนที่ POS บทที่ 9 ต้องใช้ก่อน)
 *
 * รับ `action` เข้ามาเป็น prop แทนการ import มาตรง ๆ เพราะจอ POS กับจอครัว
 * ใช้แป้นเดียวกันแต่คนละด่านสิทธิ์ (บทที่ 8) — พนักงานเสิร์ฟที่ใส่ PIN ถูก
 * ต้องเข้า /pos ได้แต่ครัวต้องไม่ได้ และ action ของแต่ละจอเป็นคนตัดสินเรื่องนั้น
 * **ห้ามก๊อปไฟล์นี้ไปทำอีกใบสำหรับจอครัว** ไม่งั้นวันที่แก้กฎความยาว PIN
 * จะแก้ที่เดียวไม่จบ
 *
 * ── รับ input ได้สองทางพร้อมกัน (คีย์บอร์ด + จอสัมผัส) ─────────────────
 * เครื่อง POS หน้าร้านเป็นจอสัมผัสไม่มีคีย์บอร์ด แต่ระหว่างพัฒนา/ตั้งค่า
 * คนนั่งหน้าโน้ตบุ๊กต้องพิมพ์ได้ด้วย ทางที่ทำให้ได้ทั้งสองทางโดยไม่ต้องเขียน
 * ตรรกะสองชุด คือ **วาง <input> จริงทับบนช่อง PIN แบบโปร่งใส**:
 *
 *   - พิมพ์คีย์บอร์ด → ลงที่ input ตรง ๆ
 *   - แตะที่ช่อง PIN → focus ไปที่ input เดียวกัน มือถือเด้งแป้นตัวเลขขึ้นมา
 *   - กดแป้นบนจอ    → setPin แล้ว focus กลับไปที่ input
 *
 * ทั้งสามทางจบที่ state ตัวเดียว ช่องหกช่องที่เห็นเป็นแค่ภาพวาดของ state นั้น
 * (จึงต้อง pointer-events-none ไม่งั้นมันจะบังการแตะที่ input ที่อยู่ข้างหลัง)
 *
 * PIN ไม่เคยถูกส่งไปไหนนอกจากตอน submit และไม่โชว์ตัวเลขจริงบนจอ (แสดงเป็นจุด)
 * เพราะจอ POS อยู่ในที่ที่ลูกค้ามองเห็น
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

/** เหลือเฉพาะตัวเลขและตัดความยาว — ใช้กับทุกทางที่ PIN ไหลเข้ามา */
const normalizePin = (value: string) => value.replace(/\D/g, "").slice(0, MAX_PIN_LENGTH);

export function PinForm({
  action,
  submitLabel = "เริ่มกะ",
  lastStaff = null,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel?: string;
  /** คนที่ใช้เครื่องนี้ล่าสุด — null เมื่อเป็นเครื่องใหม่/เพิ่งล้าง cookie */
  lastStaff?: LastStaffOnDevice | null;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, IDLE_FORM_STATE);
  const [staffCode, setStaffCode] = useState("");
  const [pin, setPin] = useState("");

  const pinInputRef = useRef<HTMLInputElement>(null);
  const staffCodeRef = useRef<HTMLInputElement>(null);

  const ready = staffCode.length > 0 && pin.length >= MIN_PIN_LENGTH;

  // โฟกัสช่องรหัสพนักงานให้ตั้งแต่เปิดหน้า — คนหน้าเครื่องพิมพ์ได้เลยโดยไม่ต้องคลิกก่อน
  useEffect(() => {
    staffCodeRef.current?.focus();
  }, []);

  /** กดแป้นบนจอแล้วต้องคืนโฟกัสให้ input ที่ซ่อนอยู่ ไม่งั้นพิมพ์ต่อด้วยคีย์บอร์ดไม่ได้ */
  const pressKey = (mutate: (current: string) => string) => {
    setPin((current) => normalizePin(mutate(current)));
    pinInputRef.current?.focus();
  };

  return (
    <form action={formAction} className="flex w-full flex-col gap-6">
      {lastStaff ? (
        /**
         * "คนล่าสุดที่ใช้เครื่องนี้" — ช่วยตอนรับกะต่อกันว่ากดต่อจากใคร
         * โชว์แค่ชื่อกับตำแหน่ง **ไม่โชว์รหัสพนักงาน** เพราะรหัสคือครึ่งหนึ่ง
         * ของสิ่งที่ต้องใช้ล็อกอิน (ดู lib/last-staff-cookie.ts)
         */
        <div className="flex items-baseline justify-between gap-3 border-2 border-[var(--color-neutral-400)] px-4 py-3">
          <span className="kicker">คนล่าสุดที่ใช้เครื่องนี้</span>
          <span className="flex items-baseline gap-3">
            <span className="display text-[16px]">{lastStaff.name}</span>
            <span className="kicker">
              {STAFF_ROLE_LABEL[lastStaff.role as StaffRole] ?? lastStaff.role}
            </span>
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <label htmlFor="staffCode" className="kicker">
          รหัสพนักงาน
        </label>
        <input
          id="staffCode"
          name="staffCode"
          ref={staffCodeRef}
          inputMode="numeric"
          autoComplete="off"
          value={staffCode}
          onChange={(event) => setStaffCode(event.target.value.trim())}
          // Enter ที่ช่องรหัส = "ไปต่อที่ PIN" ไม่ใช่ "ส่งฟอร์ม" — คนที่พิมพ์
          // ด้วยคีย์บอร์ดคาดหวังแบบนี้ และตอนกด Enter ยังไม่มี PIN ให้ส่งอยู่ดี
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              pinInputRef.current?.focus();
            }
          }}
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
              : `${pin.length} หลัก · กดส่งได้เลย`}
          </span>
        </div>

        <div className="relative">
          {/*
            input จริงที่รับทั้งคีย์บอร์ดและแป้นของมือถือ วางทับช่องทั้งหกแบบโปร่งใส
            type=password กัน PIN โผล่ตอน browser วาด autofill/แว่นขยายบนมือถือ
            (opacity-0 ทำให้มองไม่เห็นอยู่แล้ว แต่ไม่ควรพึ่ง CSS อย่างเดียว)

            ห้ามใช้ `hidden` หรือ `display:none` — ทั้งสองอย่างทำให้ focus ไม่ได้
            แล้วคีย์บอร์ดของมือถือจะไม่เด้งขึ้นมาเลย
          */}
          <input
            ref={pinInputRef}
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`PIN ${MIN_PIN_LENGTH} ถึง ${MAX_PIN_LENGTH} หลัก`}
            value={pin}
            onChange={(event) => setPin(normalizePin(event.target.value))}
            onKeyDown={(event) => {
              // กด Enter ทั้งที่ PIN ยังไม่ครบ = ฟอร์มถูกส่งไปทั้งที่ปุ่มยัง disable อยู่
              // (ปุ่ม disable กันการ "คลิก" ไม่ได้กันการ submit ด้วย Enter)
              if (event.key === "Enter" && !ready) {
                event.preventDefault();
              }
            }}
            className="absolute inset-0 z-10 h-full w-full cursor-pointer bg-transparent text-transparent opacity-0 outline-none"
          />

          <div
            aria-hidden
            className="pointer-events-none flex gap-2"
          >
            {Array.from({ length: MAX_PIN_LENGTH }, (_, index) => {
              const filled = index < pin.length;
              const isNext = index === pin.length;
              // สองช่องท้ายเป็นส่วนเกินของ PIN 4 หลัก — เส้นจางลงเพื่อไม่ให้อ่านว่า "ต้องกรอก"
              const optional = index >= MIN_PIN_LENGTH && !filled;

              return (
                <span
                  key={index}
                  className={`flex h-20 flex-1 items-center justify-center border-2 text-[36px] leading-none ${
                    optional ? "border-[var(--color-neutral-400)]" : "border-[var(--color-text)]"
                  } ${isNext ? "bg-[var(--color-accent-100)]" : "bg-[var(--color-bg)]"}`}
                >
                  {filled ? "•" : ""}
                </span>
              );
            })}
          </div>
        </div>

        <p className="kicker">แตะช่องด้านบนเพื่อพิมพ์ หรือกดแป้นตัวเลขข้างล่าง</p>
      </div>

      <div className="ink-grid grid-cols-3">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => pressKey((current) => current + key)}
            className="btn-tile py-6 text-[26px]"
          >
            {key}
          </button>
        ))}
        <button type="button" onClick={() => pressKey(() => "")} className="btn-tile py-6 text-[17px]">
          ล้าง
        </button>
        <button
          type="button"
          onClick={() => pressKey((current) => current + "0")}
          className="btn-tile py-6 text-[26px]"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => pressKey((current) => current.slice(0, -1))}
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
        disabled={!ready}
        className="btn btn-primary btn-block h-16 text-lg"
      >
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
