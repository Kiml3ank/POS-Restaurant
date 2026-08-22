"use client";

import { useEffect, useState } from "react";

/**
 * นาฬิกาจับเวลาของใบสั่ง (บทที่ 8)
 *
 * ── ทำไมต้องเดินเองฝั่ง client ทั้งที่มี SSE แล้ว ────────────────────────
 * SSE ส่งสัญญาณเมื่อ "มีอะไรเปลี่ยน" แต่เวลาที่ผ่านไปเปลี่ยนอยู่ตลอดโดยไม่มี
 * อะไรเกิดขึ้นเลย ถ้าให้ตัวเลขนี้มาจาก server มันจะค้างอยู่ที่ "2 นาที"
 * จนกว่าจะมีคนกดปุ่มอะไรสักอย่าง แล้วครัวจะอ่านมันผิดทั้งกะ
 *
 * ทางเลือกที่ไม่เอา: refresh หน้าทั้งหน้าทุกนาทีเพื่ออัปเดตตัวเลข —
 * เปลืองกว่ามากและทำให้จอกะพริบโดยไม่มีเหตุ
 *
 * ── กันhydration mismatch ─────────────────────────────────────────────────
 * เวลาของ server กับของเครื่องครัวไม่ตรงกันเป๊ะแน่นอน จึง render รอบแรกด้วยค่า
 * ที่ server คำนวณมาให้ (`initialMinutes`) แล้วค่อยเปลี่ยนไปใช้เวลาของเครื่อง
 * เองใน useEffect ซึ่งรันหลัง hydrate — HTML สองฝั่งจึงตรงกันเสมอ
 */

/** เกินกี่นาทีถือว่า "ช้าแล้ว" — ใช้เน้นใบที่ต้องรีบ */
export const LATE_AFTER_MINUTES = 12;

export function Elapsed({
  since,
  initialMinutes,
}: {
  /** epoch milliseconds ตอนที่บิลเข้าคิวครัว */
  since: number;
  initialMinutes: number;
}) {
  const [minutes, setMinutes] = useState(initialMinutes);

  useEffect(() => {
    const tick = () => setMinutes(Math.max(0, Math.floor((Date.now() - since) / 60_000)));

    tick();

    // เดินทุก 15 วินาที ไม่ใช่ทุกวินาที — ตัวเลขที่แสดงเป็นหน่วยนาที
    // การ re-render ถี่กว่าที่ตาเห็นความต่างคือการเผา CPU ของแท็บเล็ตในครัวเปล่า ๆ
    const timer = setInterval(tick, 15_000);

    return () => clearInterval(timer);
  }, [since]);

  return (
    <span className={minutes >= LATE_AFTER_MINUTES ? "text-[var(--color-accent)]" : undefined}>
      {minutes < 1 ? "เพิ่งเข้า" : `${minutes} นาที`}
    </span>
  );
}
