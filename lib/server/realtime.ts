import "server-only";

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { isRealtimeEvent, type RealtimeEvent } from "@/lib/realtime-events";
import { prisma } from "@/lib/server/db";

/**
 * pub/sub ของ event realtime (บทที่ 8)
 *
 * ── ทำไมต้องมีชั้นนี้ ────────────────────────────────────────────────────
 * SSE เองแก้ปัญหาแค่ "ส่งจาก server ตัวนี้ไปหา browser" เท่านั้น
 * ปัญหาที่ยากกว่าคือ **คนที่เขียนกับคนที่ถือสายไม่ได้อยู่ process เดียวกัน**
 *
 *   instance A ── ลูกค้ากดส่งออร์เดอร์ (POST) ──▶ เขียน DB เสร็จ
 *   instance B ── จอครัวเปิด SSE ค้างอยู่ที่นี่ ──▶ ไม่มีใครบอกมันเลย
 *
 * บน Vercel หรือ container หลายตัว เรื่องนี้เกิดแน่นอน ไม่ใช่กรณีหายาก
 * จึงต้องมี "ที่นัดพบ" กลางตั้งแต่ต้น ไม่ใช่ค่อยมาเติมทีหลังตอนย้ายขึ้น
 * production แล้วพบว่าโค้ดทั้งบททำงานได้เฉพาะตอนรัน dev เครื่องเดียว
 *
 * ── สอง driver ───────────────────────────────────────────────────────────
 *   memory   (ค่าเริ่มต้น) EventEmitter ใน process เดียว พอสำหรับ `next dev`
 *                          และการ deploy แบบ instance เดียว
 *   postgres LISTEN/NOTIFY ของ Postgres เป็นที่นัดพบกลาง
 *                          เปิดด้วย `REALTIME_DRIVER=postgres` ใน .env
 *
 * เลือกด้วย env ไม่ใช่ if กระจายตามที่เรียก — จุดที่ publish/subscribe
 * ไม่ต้องรู้เลยว่าใต้ท้องเป็นอะไร
 *
 * ── สำคัญ: local-first ───────────────────────────────────────────────────
 * ทั้งสอง driver **emit เข้า EventEmitter ในเครื่องตัวเองก่อนเสมอ**
 * แล้ว driver postgres ค่อยยิง NOTIFY ออกไปให้ instance อื่นเพิ่ม
 * ตอนรับ NOTIFY กลับมา ถ้าเป็นของที่ตัวเองยิงออกไปเอง (originId ตรงกัน) จะทิ้ง
 *
 * ทำแบบนี้เพราะถ้าปล่อยให้ event ของตัวเองต้องวิ่งอ้อมผ่าน Postgres ก่อนเสมอ
 * แปลว่าเมื่อสาย LISTEN หลุด (network สะดุด / DB restart) จอครัวที่เสียบอยู่กับ
 * instance เดียวกับที่รับออร์เดอร์ จะไม่เห็นออร์เดอร์ของตัวเองไปด้วย
 * — ครัวหยุดทำงานเพราะปัญหาที่ไม่เกี่ยวกับครัวเลย
 */

/**
 * ชื่อ channel ของ LISTEN/NOTIFY — ต้องเป็น identifier ที่ Postgres รับได้
 *
 * export ออกไปเพื่อให้สคริปต์ทดสอบปลอมตัวเป็น "instance อื่น" ได้ด้วยการยิง
 * pg_notify เข้ามาเอง (ดู scripts/smoke-kds.ts) — เป็นวิธีเดียวที่ทดสอบเส้นทาง
 * LISTEN ได้จริงจาก process เดียว เพราะ event ที่ตัวเองยิงจะถูกกรองทิ้งตาม originId
 */
export const REALTIME_PG_CHANNEL = "pos_realtime";

const PG_CHANNEL = REALTIME_PG_CHANNEL;

export type RealtimeListener = (event: RealtimeEvent) => void;

type WirePayload = {
  /** id ของ process ที่ยิง event นี้ — ใช้ทิ้ง NOTIFY ที่เด้งกลับมาหาตัวเอง */
  o: string;
  e: RealtimeEvent;
};

type PostgresListener = { stop: () => Promise<void> };

type RealtimeHub = {
  originId: string;
  emitter: EventEmitter;
  /** สาย LISTEN ที่ค้างอยู่ — null เมื่อใช้ driver memory หรือยังต่อไม่ติด */
  listener: PostgresListener | null;
  listenerStarting: Promise<void> | null;
};

function driver(): "memory" | "postgres" {
  return process.env.REALTIME_DRIVER === "postgres" ? "postgres" : "memory";
}

/**
 * hub อยู่บน globalThis ด้วยเหตุผลเดียวกับ Prisma client ใน lib/server/db.ts —
 * `next dev` โหลดโมดูลนี้ใหม่ทุกครั้งที่แก้ไฟล์ ถ้าเก็บไว้ใน module scope เฉย ๆ
 * จอครัวที่เปิดค้างไว้จะไปรอฟังจาก emitter ตัวเก่าที่ไม่มีใครยิงเข้าแล้ว
 */
const globalForRealtime = globalThis as unknown as { posRealtime?: RealtimeHub };

function hub(): RealtimeHub {
  const existing = globalForRealtime.posRealtime;

  if (existing) {
    return existing;
  }

  const emitter = new EventEmitter();

  // จอครัวหลายจอ + มือถือลูกค้าหลายเครื่องต่อ instance เดียว ชนเพดาน 10 ตัวง่ายมาก
  // (ค่าเริ่มต้นของ Node มีไว้จับ listener leak ซึ่งไม่ใช่กรณีนี้ — เราถอด listener
  //  ทุกตัวตอนสายขาดอยู่แล้ว ดู subscribeToBranch)
  emitter.setMaxListeners(0);

  const created: RealtimeHub = {
    originId: randomUUID(),
    emitter,
    listener: null,
    listenerStarting: null,
  };

  globalForRealtime.posRealtime = created;

  return created;
}

/**
 * ประกาศว่ามีอะไรเปลี่ยน
 *
 * **เรียกหลัง transaction commit เสมอ ห้ามเรียกข้างใน `$transaction`**
 * เพราะถ้า transaction rollback ทีหลัง เราจะบอกจอครัวไปแล้วว่าออร์เดอร์เข้ามา
 * ทั้งที่ในฐานข้อมูลไม่มีอะไรเลย แล้วครัวจะทำอาหารที่ไม่มีใครสั่ง
 *
 * ตั้งใจไม่ throw ต่อ: การแจ้งเตือนล้มเหลวต้องไม่ทำให้ "การสั่งอาหาร" ล้มเหลวตาม
 * ผลที่แย่ที่สุดของการเงียบคือจอครัวช้าไปจนกว่าจะมี event ถัดไป ซึ่งเบากว่า
 * ลูกค้ากดสั่งแล้วขึ้น error ทั้งที่บิลเข้า DB เรียบร้อยไปแล้ว
 */
export async function publishRealtimeEvent(event: RealtimeEvent): Promise<void> {
  const current = hub();

  try {
    current.emitter.emit(PG_CHANNEL, event);
  } catch (error) {
    console.error("[realtime] emit ในเครื่องล้มเหลว", error);
  }

  if (driver() !== "postgres") {
    return;
  }

  const payload: WirePayload = { o: current.originId, e: event };

  try {
    // ใช้ connection pool ของ Prisma ยิง NOTIFY ได้เลย ไม่ต้องเปิด connection ที่สอง
    // (ฝั่ง LISTEN ต่างหากที่ต้องมี connection ของตัวเองเพราะต้องค้างไว้ตลอด)
    await prisma.$executeRaw`SELECT pg_notify(${PG_CHANNEL}, ${JSON.stringify(payload)})`;
  } catch (error) {
    console.error("[realtime] pg_notify ล้มเหลว — instance อื่นจะไม่ได้รับ event นี้", error);
  }
}

/**
 * รับ event ของ "สาขาเดียว" — คืนฟังก์ชันสำหรับเลิกฟัง
 *
 * ผู้เรียกทุกคนต้องเรียกฟังก์ชันที่คืนมาเมื่อสายขาด ไม่งั้น listener ค้างสะสม
 * (route handler ของ SSE ผูกไว้กับ `request.signal` แล้ว ดู app/api/realtime/route.ts)
 */
export function subscribeToBranch(branchId: string, listener: RealtimeListener): () => void {
  const current = hub();

  // ไม่ await โดยตั้งใจ — คนที่เพิ่งเสียบจอครัวต้องได้ event ที่เกิดใน instance
  // เดียวกันทันที ไม่ต้องรอ handshake ของ LISTEN ให้เสร็จก่อน
  void ensurePostgresListener();

  const handler: RealtimeListener = (event) => {
    if (event.branchId !== branchId) {
      return;
    }

    listener(event);
  };

  current.emitter.on(PG_CHANNEL, handler);

  return () => {
    current.emitter.off(PG_CHANNEL, handler);
  };
}

/**
 * เปิดสาย LISTEN ค้างไว้ "เส้นเดียวต่อ process" (เฉพาะ driver postgres)
 *
 * ใช้ `pg` ตรง ๆ ไม่ผ่าน Prisma เพราะ LISTEN ผูกกับ connection เส้นเดิมตลอดอายุ
 * connection pool ที่คืน connection กลับ pool หลังจบทุก query จะทำให้ NOTIFY
 * ตกหล่นแบบเงียบ ๆ
 */
async function ensurePostgresListener(): Promise<void> {
  const current = hub();

  if (driver() !== "postgres" || current.listener) {
    return;
  }

  // กันเคสที่จอครัวสามจอเปิดพร้อมกันแล้วแย่งกันเปิดสาย LISTEN คนละเส้น
  if (!current.listenerStarting) {
    current.listenerStarting = startPostgresListener((payload) => {
      // ของที่ตัวเองยิงออกไป emit ไปแล้วตั้งแต่ตอน publish — ถ้า emit ซ้ำ
      // จอครัวจะ refresh สองรอบต่อหนึ่งเหตุการณ์
      if (payload.o === current.originId) {
        return;
      }

      current.emitter.emit(PG_CHANNEL, payload.e);
    })
      .then((listener) => {
        current.listener = listener;
      })
      .catch((error) => {
        console.error("[realtime] เปิด LISTEN ไม่สำเร็จ — จะทำงานแบบ instance เดียวไปก่อน", error);
      })
      .finally(() => {
        current.listenerStarting = null;
      });
  }

  await current.listenerStarting;
}

/** หน่วงก่อนต่อใหม่ — เริ่มเร็วแล้วถอยห่างขึ้นเรื่อย ๆ กัน DB ที่กำลังรีสตาร์ทโดนถล่ม */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

async function startPostgresListener(
  onPayload: (payload: WirePayload) => void,
): Promise<PostgresListener> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("ตั้ง REALTIME_DRIVER=postgres ไว้แต่ไม่มี DATABASE_URL");
  }

  // import แบบ dynamic เพื่อไม่ให้ driver memory ต้องแบก pg ติดไปด้วย
  const { Client } = await import("pg");

  let stopped = false;
  let client: InstanceType<typeof Client> | null = null;
  let attempt = 0;

  const connect = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    const next = new Client({ connectionString });
    client = next;

    next.on("notification", (message) => {
      if (message.channel !== PG_CHANNEL || !message.payload) {
        return;
      }

      try {
        const parsed = JSON.parse(message.payload) as WirePayload;

        if (typeof parsed?.o === "string" && isRealtimeEvent(parsed?.e)) {
          onPayload(parsed);
        }
      } catch (error) {
        console.error("[realtime] payload ที่ได้จาก NOTIFY อ่านไม่ออก", error);
      }
    });

    // Client ของ pg รายงาน error เป็น event ไม่ใช่ throw — ถ้าไม่ดักตรงนี้ process ตายทั้งตัว
    next.on("error", (error) => {
      console.error("[realtime] สาย LISTEN หลุด กำลังต่อใหม่", error);
      void reconnect();
    });

    await next.connect();
    await next.query(`LISTEN ${PG_CHANNEL}`);
    attempt = 0;
  };

  const reconnect = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
    attempt += 1;

    try {
      await client?.end();
    } catch {
      // ปิดสายเก่าไม่สำเร็จก็ไม่เป็นไร กำลังจะเปิดสายใหม่อยู่แล้ว
    }

    setTimeout(() => {
      connect().catch((error) => {
        console.error("[realtime] ต่อสาย LISTEN ใหม่ไม่สำเร็จ", error);
        void reconnect();
      });
    }, delay);
  };

  await connect();

  return {
    stop: async () => {
      stopped = true;
      await client?.end();
    },
  };
}

/** บังคับเปิดสาย LISTEN แล้วรอให้พร้อม — สคริปต์ทดสอบใช้ ปกติ subscribe เปิดให้เอง */
export async function startRealtime(): Promise<void> {
  await ensurePostgresListener();
}

/** ปิดสาย LISTEN ทิ้ง — ใช้ในสคริปต์ทดสอบเท่านั้น เพื่อให้ process จบเองได้ */
export async function stopRealtime(): Promise<void> {
  const current = globalForRealtime.posRealtime;

  if (!current) {
    return;
  }

  await current.listenerStarting;
  await current.listener?.stop();
  current.listener = null;
  current.emitter.removeAllListeners();
}
