import type { NextRequest } from "next/server";

import {
  CUSTOMER_BROADCAST_EVENTS,
  REALTIME_SSE_EVENT,
  type RealtimeEvent,
} from "@/lib/realtime-events";
import { subscribeToBranch } from "@/lib/server/realtime";
import { getCurrentStaff } from "@/lib/server/staff-session";
import { resolveCustomerContext } from "@/lib/server/table-session";

/**
 * ท่อ realtime ของทั้งระบบ — Server-Sent Events ผ่าน Route Handler (บทที่ 8)
 *
 * ── ทำไม SSE ไม่ใช่ WebSocket ────────────────────────────────────────────
 * Route Handler ของ Next.js อัปเกรด HTTP connection เป็น WebSocket ไม่ได้
 * (ไม่มีทางเข้าถึง raw socket) และ Vercel ถือ TCP connection ค้างไว้ไม่ได้
 * ถ้าอยากได้ WebSocket จริงต้องแยก server ต่างหาก หรือใช้ Pusher/Ably
 * ซึ่งเป็นการตัดสินใจเรื่อง hosting ที่ผูกกันตั้งแต่บทที่ 8 ถึงบทที่ 16
 *
 * และงานนี้ไม่ต้องการ WebSocket จริง ๆ ด้วย: ข้อมูลวิ่งทางเดียวจาก server
 * ไปหาจอ (ครัวกดปุ่มผ่าน Server Action ไม่ใช่ผ่านสายนี้) ซึ่งคือสิ่งที่ SSE
 * ออกแบบมาทำพอดี แถมได้ auto-reconnect ของเบราว์เซอร์ฟรีโดยไม่ต้องเขียนเอง
 *
 * ── ใครต่อสายนี้ได้บ้าง ──────────────────────────────────────────────────
 *   ?table=<tableCode>  ลูกค้าที่มี cookie ของรอบโต๊ะนั้น → ได้เฉพาะ event ของโต๊ะตัวเอง
 *   (ไม่มี query)        พนักงานที่ล็อกอินแล้ว           → ได้ทุก event ของสาขาตัวเอง
 *
 * ทั้งสองทางตรวจสิทธิ์ด้วยฟังก์ชันตัวเดียวกับที่หน้าจอใช้ ไม่มีทางลัดของตัวเอง
 */

/**
 * ต้องเป็น nodejs runtime เพราะ pub/sub ใช้ EventEmitter และ pg (LISTEN/NOTIFY)
 * ซึ่ง edge runtime ไม่มีให้
 */
export const runtime = "nodejs";

/** สายนี้เปิดค้างและขึ้นกับ cookie ของคนเรียก ห้ามให้ถูก prerender หรือ cache เด็ดขาด */
export const dynamic = "force-dynamic";

/**
 * ปิดสายเองทุก 5 นาทีแล้วให้เบราว์เซอร์ต่อใหม่
 *
 * ไม่ได้ทำเพราะอยากปิด แต่เพราะ **ทุก platform มีเพดานอายุ request ของตัวเอง**
 * (Vercel ตัดตาม maxDuration, reverse proxy ตัดที่ 60 วินาทีบ้าง 120 บ้าง)
 * ถ้าปล่อยให้ปลายทางเป็นคนตัด สายจะขาดแบบ error ซึ่งอ่าน log ยากและบางที
 * client ก็ไม่ต่อใหม่ให้ การปิดเองก่อนแบบสุภาพ + `retry:` ที่ส่งไปตอนเปิดสาย
 * ทำให้การต่อใหม่เป็นเรื่องปกติที่ควบคุมได้ ไม่ใช่อุบัติเหตุ
 */
const STREAM_LIFETIME_MS = 5 * 60 * 1000;

/**
 * เต้นหัวใจทุก 25 วินาที
 *
 * reverse proxy ส่วนใหญ่ตัดสายที่เงียบเกิน 30-60 วินาที และครัวที่ไม่มีออร์เดอร์
 * เข้ามาสิบนาทีคือเรื่องปกติ บรรทัด comment (`:` นำหน้า) ไม่ถูกนับเป็น event
 * ฝั่ง client จึงไม่ต้องเขียนอะไรมารับ แต่พอทำให้สายไม่เงียบ
 */
const HEARTBEAT_MS = 25_000;

/** บอกเบราว์เซอร์ว่าถ้าสายขาดให้รอเท่านี้ก่อนต่อใหม่ (ค่าเริ่มต้นของสเปคคือ 3 วินาที) */
const CLIENT_RETRY_MS = 3_000;

type Audience = {
  branchId: string;
  /** ไม่ null = ส่งเฉพาะ event ของโต๊ะนี้ (มือถือลูกค้า) */
  onlyTableId: string | null;
  label: string;
};

export async function GET(request: NextRequest) {
  const audience = await resolveAudience(request);

  if (!audience) {
    // 401 ตรง ๆ ไม่ใช่ redirect — EventSource ตาม redirect ไปหน้า HTML แล้วจะ
    // พังด้วย error ที่อ่านไม่รู้เรื่องว่า "content-type ไม่ใช่ text/event-stream"
    return new Response("unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      /**
       * เขียนลงสายแบบไม่ throw
       *
       * ระหว่างที่ browser ปิดแท็บ จะมีจังหวะสั้น ๆ ที่ controller ถูกปิดไปแล้ว
       * แต่ listener ยังไม่ถูกถอด — enqueue ตอนนั้นจะ throw ขึ้นไปถึง
       * unhandled rejection แล้ว process ตาย ทั้งที่ไม่มีอะไรผิดปกติเลย
       */
      const write = (chunk: string) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      write(`retry: ${CLIENT_RETRY_MS}\n\n`);
      // event แรกบอกว่า "ต่อติดแล้ว" — จอครัวเอาไปโชว์ไฟสถานะให้คนในครัวเห็น
      // ว่าจอที่กำลังมองอยู่เป็นของสด ไม่ใช่ภาพค้างจากเมื่อยี่สิบนาทีที่แล้ว
      write(`event: pos-ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);

      const unsubscribe = subscribeToBranch(audience.branchId, (event: RealtimeEvent) => {
        // ลูกค้าโต๊ะ A ต้องไม่ได้รับแม้แต่สัญญาณเปล่าของโต๊ะ B
        // (นับจำนวนสัญญาณที่ได้รับก็พอเดาได้แล้วว่าโต๊ะไหนสั่งบ่อยแค่ไหน)
        //
        // ยกเว้น event ระดับสาขาที่อยู่ในรายชื่อ CUSTOMER_BROADCAST_EVENTS
        // (ตอนนี้มีตัวเดียวคือ menu.changed — เมนูร้านเป็นข้อมูลที่ลูกค้าเห็นอยู่แล้ว
        //  ส่งให้ทุกโต๊ะจึงไม่รั่วอะไร ดูเหตุผลเต็มใน lib/realtime-events.ts)
        // ค่าเริ่มต้นยังเป็น "ไม่ส่ง" เสมอ ต้องเติมชื่อเข้าไปเองถึงจะผ่าน
        if (
          audience.onlyTableId &&
          event.tableId !== audience.onlyTableId &&
          !CUSTOMER_BROADCAST_EVENTS.includes(event.type)
        ) {
          return;
        }

        write(`event: ${REALTIME_SSE_EVENT}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        write(`: keep-alive ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      const lifetime = setTimeout(() => {
        finish();
      }, STREAM_LIFETIME_MS);

      function finish() {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();

        try {
          controller.close();
        } catch {
          // ปิดไปแล้วจากทางฝั่ง client ก็ไม่มีอะไรต้องทำต่อ
        }
      }

      // ปลายทางเดียวที่รับประกันว่าถูกเรียกเมื่อ browser ปิดแท็บ/หลุดเน็ต
      // ถ้าไม่ถอด listener ตรงนี้ ทุกครั้งที่จอครัว reconnect จะทิ้ง listener
      // ค้างไว้หนึ่งตัว แล้วภายในหนึ่งกะ memory จะบวมโดยไม่มีใครสังเกต
      request.signal.addEventListener("abort", finish);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform สำคัญพอ ๆ กับ no-cache — proxy ที่ gzip ให้เองจะ buffer
      // ทั้งสายไว้จนกว่าจะปิด ซึ่งทำให้ realtime กลายเป็น "มาทีเดียวตอนจบ"
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx ปิด buffering ด้วย header นี้ (ปลายทางที่ไม่ใช่ nginx จะไม่สนใจ)
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * ตัดสินว่าคนที่ต่อสายเข้ามาเป็นใคร และมีสิทธิ์เห็น event ของขอบเขตไหน
 *
 * ใช้ฟังก์ชันตรวจสิทธิ์ตัวเดียวกับที่หน้าจอใช้ (resolveCustomerContext /
 * getCurrentStaff) ไม่เขียนตรรกะตรวจ cookie ขึ้นมาใหม่ที่นี่ — ถ้าเขียนใหม่
 * วันหนึ่งกฎสองชุดจะเพี้ยนออกจากกันแล้วสายนี้จะกลายเป็นประตูหลัง
 */
async function resolveAudience(request: NextRequest): Promise<Audience | null> {
  const tableCode = request.nextUrl.searchParams.get("table");

  if (tableCode) {
    const context = await resolveCustomerContext(tableCode);

    // ไม่มีรอบโต๊ะที่เปิดอยู่ = ไม่มีอะไรให้ติดตาม (และเป็นเงื่อนไขเดียวกับที่
    // หน้าจอลูกค้าใช้เด้งกลับไปหน้าเปิดโต๊ะ)
    if (!context?.session) {
      return null;
    }

    return {
      branchId: context.branch.id,
      onlyTableId: context.table.id,
      label: `table:${context.table.name}`,
    };
  }

  const staff = await getCurrentStaff();

  if (!staff) {
    return null;
  }

  return { branchId: staff.branchId, onlyTableId: null, label: `staff:${staff.code}` };
}
