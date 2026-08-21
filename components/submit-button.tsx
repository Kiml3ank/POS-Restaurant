"use client";

import { useFormStatus } from "react-dom";

/**
 * ปุ่ม submit ที่ปิดตัวเองระหว่างที่ action ยังทำงานอยู่ (บทที่ 7 — กันกดส่งซ้ำ)
 *
 * ต้องแยกเป็น component ย่อยแบบนี้เพราะ useFormStatus อ่านสถานะจาก <form>
 * ที่เป็น "ตัวครอบ" ของตัวเองเท่านั้น ถ้าเรียกในไฟล์เดียวกับที่ render <form>
 * จะได้ pending = false ตลอด
 *
 * ย้ำ: นี่เป็นแค่ชั้นกัน "กดรัว" บนหน้าจอ ชั้นที่กันซ้ำได้จริงอยู่ที่
 * conditional update ใน lib/server/cart.ts เพราะ POST ยิงตรงเข้ามาได้
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = "",
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={`transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
