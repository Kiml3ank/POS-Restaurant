"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { REALTIME_SSE_EVENT, isRealtimeEvent } from "@/lib/realtime-events";

/**
 * ตัวรับ event realtime ของทุกหน้าจอ (บทที่ 8)
 *
 * ── ทำไมถึงเป็น component จิ๋ว ๆ ตัวเดียวใช้ได้ทุกจอ ──────────────────────
 * เพราะ event ที่วิ่งมาเป็นแค่สัญญาณ ไม่ใช่ข้อมูล (ดู lib/realtime-events.ts)
 * หน้าที่ของฝั่ง client จึงเหลือแค่ "ได้ยินแล้วสั่ง router.refresh()"
 * แล้ว React Server Component ไปดึงของใหม่ผ่านด่านสิทธิ์เดิม
 *
 * ผลพลอยได้ที่สำคัญ: หน้าจอทั้งสี่ไม่ต้องมี state ของตัวเองเลยสักตัว
 * ไม่มีเคส "ข้อมูลบนจอกับข้อมูลใน DB ไม่ตรงกันเพราะ merge patch ผิด"
 * ซึ่งเป็นบั๊กที่หาสาเหตุยากที่สุดของระบบ realtime
 *
 * ── สิ่งที่ component นี้ตั้งใจ "ไม่" ทำ ──────────────────────────────────
 * ไม่ต่อสายใหม่เอง — EventSource ของเบราว์เซอร์ต่อใหม่ให้อยู่แล้วตามค่า `retry:`
 * ที่ server ส่งมา การเขียน reconnect ทับลงไปอีกชั้นมีแต่จะทำให้เกิดสองสาย
 * ซ้อนกันตอนเน็ตกระตุก
 */

type Status = "connecting" | "live" | "offline";

/**
 * รวบ event ที่มาติด ๆ กันให้เหลือ refresh ครั้งเดียว
 *
 * จำเป็นจริง ไม่ใช่การ optimize เผื่อ: พนักงานกด "บั๊มทั้งใบ" หนึ่งครั้ง
 * = หลาย event เกือบพร้อมกัน ถ้า refresh ทุกตัวจะยิง render ฝั่ง server
 * ซ้อนกันหลายรอบเพื่อผลลัพธ์หน้าตาเดียวกัน
 *
 * 300ms เลือกจากที่ครัวรู้สึกว่า "ทันที" (งานวิจัย HCI ใช้เส้น ~100ms สำหรับ
 * การตอบสนองต่อการกดของตัวเอง แต่นี่คือของที่คนอื่นทำให้เกิด ซึ่งยืดได้กว่ามาก)
 */
const COALESCE_MS = 300;

export function LiveRefresh({
  src,
  /** "dot" = จุดเล็ก ๆ กับข้อความสั้น (ใช้บนแถบหัวจอ) · "hidden" = ไม่แสดงอะไรเลย */
  variant = "dot",
  className = "",
}: {
  src: string;
  variant?: "dot" | "hidden";
  className?: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("connecting");

  /**
   * เก็บ router ไว้ใน ref เพื่อไม่ให้ effect ที่เปิดสาย SSE ต้องผูกกับตัว router
   *
   * ถ้าใส่ router ลงใน deps ตรง ๆ แล้ววันหนึ่ง Next.js เปลี่ยน identity ของมัน
   * ระหว่าง render เราจะได้วงจร "refresh → router ใหม่ → ตัดสาย → ต่อสายใหม่ →
   * ..." ซึ่งกลายเป็นการถล่ม server ของตัวเองแบบที่ดูเหมือนทำงานปกติทุกอย่าง
   *
   * เขียนค่าลง ref ใน effect ไม่ใช่ระหว่าง render — การแตะ ref ตอน render
   * ผิดกฎ purity ของ React (และ eslint จับได้จริง)
   */
  const routerRef = useRef(router);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const source = new EventSource(src);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        routerRef.current.refresh();
      }, COALESCE_MS);
    };

    source.addEventListener("open", () => setStatus("live"));
    source.addEventListener("pos-ready", () => setStatus("live"));

    source.addEventListener(REALTIME_SSE_EVENT, (event) => {
      setStatus("live");

      // ตรวจรูปร่างก่อนเชื่อ — client ที่ค้างอยู่ข้ามการ deploy อาจได้ payload
      // เวอร์ชันใหม่ที่อ่านไม่ออก ปล่อยผ่านไปเฉย ๆ ดีกว่า refresh มั่ว
      try {
        if (isRealtimeEvent(JSON.parse((event as MessageEvent<string>).data))) {
          scheduleRefresh();
        }
      } catch {
        // payload อ่านไม่ออก = ไม่ทำอะไร รอ event ตัวถัดไป
      }
    });

    /**
     * onerror ของ EventSource ยิงทั้งตอน "สายขาดกำลังจะต่อใหม่" และตอน
     * "ต่อไม่ได้เลย" แยกกันด้วย readyState เท่านั้น — CLOSED คือจบจริง
     * (เกิดตอน server ตอบ 401 เช่น กะหมดอายุระหว่างที่จอเปิดค้างไว้)
     */
    source.addEventListener("error", () => {
      setStatus(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    });

    return () => {
      if (timer) {
        clearTimeout(timer);
      }

      source.close();
    };
  }, [src]);

  if (variant === "hidden") {
    return null;
  }

  const text = t(
    status === "live" ? "live.live" : status === "connecting" ? "live.connecting" : "live.offline",
  );

  return (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-2 text-[11px] tracking-[0.14em] uppercase ${className}`}
    >
      <span
        aria-hidden
        className={`size-2 flex-none ${
          status === "live"
            ? "bg-[currentColor] opacity-90"
            : status === "connecting"
              ? "bg-[currentColor] opacity-40"
              : "bg-[currentColor] opacity-100 animate-pulse"
        }`}
      />
      {text}
    </span>
  );
}
