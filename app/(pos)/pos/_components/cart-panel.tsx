"use client";

import { useEffect, useState } from "react";

/**
 * ตะกร้าของหน้าโต๊ะ — แผงปักขวาบนจอกว้าง / แผ่นที่กางขึ้นจากล่างบนจอแคบ
 *
 * ── ข้อบังคับที่ห้ามละเมิดไม่ว่าจอขนาดไหน ────────────────────────────────
 * CLAUDE.md เขียนไว้ว่า **ห้ามแยกเมนูกับตะกร้าออกเป็นคนละหน้า** เพราะพนักงาน
 * พูดกับลูกค้าไปกดไป ต้องเห็นตะกร้าโตขึ้นทันทีที่กดโดยไม่มีการเปลี่ยนหน้าคั่น
 *
 * บนจอแคบจึงไม่ทำเป็นลิงก์ไปหน้าตะกร้า แต่เป็นแถบสรุปที่ **ปักอยู่ล่างจอตลอดเวลา**
 * บอกจำนวนรายการกับยอดรวม แตะแล้วกางขึ้นมา — ตัวเลขบนแถบขยับทุกครั้งที่กดเพิ่มของ
 * ซึ่งคือสิ่งที่กฎข้อนั้นต้องการจริง ๆ ส่วนการกางเต็มมีไว้ตอนจะแก้จำนวนหรือกดส่ง
 * ซึ่งเป็นจังหวะที่หยุดคุยกับลูกค้าแล้ว
 *
 * ── ทำไมเป็น element เดียวที่เปลี่ยนรูปร่างตัวเอง ไม่ใช่สองชุดสลับกันโชว์ ──
 * เพราะ `children` คือตะกร้าที่ render มาจาก server และข้างในมี <form> หลายใบ
 * (ปุ่มเพิ่ม/ลดจำนวน + ปุ่มส่งเข้าครัว) ถ้า render สองชุดแล้วซ่อนชุดหนึ่งด้วย CSS
 * จะได้ฟอร์มซ้ำสองใบในหน้าเดียว: useActionState เดินสองตัว, ปุ่มที่ซ่อนอยู่ยังถูก
 * นับเป็น submit target และ screen reader อ่านตะกร้าซ้ำสองรอบ
 * ที่นี่จึงมีเนื้อในชุดเดียว มีแค่ "หัว" ที่ต่างกันสองแบบ (ซึ่งไม่มีฟอร์มอยู่ข้างใน)
 *
 * ── ทำไมต้องเป็น client component ───────────────────────────────────────
 * ต้องการ state "กางอยู่ไหม" อย่างเดียว เนื้อในทั้งหมดยังมาจาก server เหมือนเดิม
 * ไฟล์นี้จึงไม่รู้จัก Prisma หรือรูปร่างของตะกร้าเลยแม้แต่นิดเดียว
 */
export function CartPanel({
  itemCount,
  totalLabel,
  children,
}: {
  itemCount: number;
  /** ยอดรวมที่ format มาแล้วจากฝั่ง server — ที่นี่ห้ามคิดเลขเงินเอง (CLAUDE.md หัวข้อ 4) */
  totalLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // กด Esc ปิดแผ่น — เครื่อง POS หลายร้านต่อคีย์บอร์ดไว้ (สแกนบาร์โค้ด/พิมพ์เร็ว)
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <aside
      className={
        // จอแคบ: กล่องเตี้ย ๆ ปิดท้ายคอลัมน์ · จอกว้าง (xl): แผงปักขวา 1/3 ของจอ
        //
        // เดิมตรึงไว้ที่ 412px ซึ่งพอดีที่ 1280px (32%) แต่บนจอ 1920px เหลือแค่ 21%
        // แล้วชื่อเมนูยาว ๆ ในตะกร้าตัดบรรทัดทั้งที่ฝั่งเมนูมีที่ว่างเหลือเฟือ
        //
        // min/max ต้องมีคู่กันเสมอ: ไม่มี min แล้วตะกร้าจะแคบกว่า 412px เดิมไม่ได้
        // (1280/3 = 426px ผ่านพอดี) · ไม่มี max แล้วบนจอ 4K ตะกร้าจะกว้าง 1280px
        // ซึ่งกว้างกว่าที่ตะกร้ามีอะไรให้แสดงมาก
        "flex flex-none flex-col border-t-2 border-[var(--color-text)] bg-[var(--color-neutral-100)] " +
        "xl:w-1/3 xl:max-w-[560px] xl:min-w-[412px] xl:border-t-0 xl:border-l-2"
      }
    >
      {/* หัวแบบจอกว้าง — ไม่มีปุ่ม เพราะแผงกางอยู่ตลอดเวลาอยู่แล้ว */}
      <div className="hidden flex-none items-center justify-between gap-3 border-b-2 border-[var(--color-text)] px-6 py-4 xl:flex">
        <div className="flex flex-col gap-0.5">
          <span className="display text-[20px]">ตะกร้า</span>
          <span className="kicker">ยังไม่ส่งเข้าครัว</span>
        </div>
        <span className="display text-[20px]">{itemCount} รายการ</span>
      </div>

      {/* หัวแบบจอแคบ — เป็นปุ่มกาง/ยุบ และเป็นที่ที่ยอดรวมโผล่ตอนยุบอยู่ */}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-[62px] w-full flex-none items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-accent-100)] xl:hidden"
      >
        <span className="flex min-w-0 flex-col">
          <span className="kicker">ตะกร้า · ยังไม่ส่งเข้าครัว</span>
          <span className="display text-[16px]">{itemCount} รายการ</span>
        </span>

        <span className="flex flex-none items-baseline gap-3">
          <span className="display text-[22px]">{totalLabel}</span>
          {/* ลูกศรเป็นตัวหนังสือธรรมดา ไม่ใช่ไอคอนจากไลบรารี — ระบบนี้ยังไม่มี
              icon set และไม่ควรเพิ่ม dependency ทั้งตัวเพื่อลูกศรอันเดียว */}
          <span aria-hidden className="display text-[18px] leading-none">
            {open ? "▾" : "▴"}
          </span>
        </span>
      </button>

      {/*
        เนื้อในชุดเดียว: จอแคบซ่อน/โชว์ตาม state · จอกว้างโชว์เสมอ
        `max-h-[60dvh]` กันไม่ให้แผ่นที่กางแล้วดันเมนูจนหายไปทั้งจอ —
        พนักงานต้องยังเห็นว่าตัวเองอยู่หน้าไหนอยู่
      */}
      <div
        className={`min-h-0 flex-col ${
          open ? "flex max-h-[60dvh]" : "hidden"
        } xl:flex xl:max-h-none xl:flex-1`}
      >
        {children}
      </div>
    </aside>
  );
}
