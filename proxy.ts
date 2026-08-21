import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { STAFF_SESSION_COOKIE } from "@/lib/staff-session-cookie";
import { TABLE_SESSION_COOKIE } from "@/lib/table-session-cookie";

/**
 * Proxy (Next.js 16.2 เปลี่ยนชื่อ convention จาก middleware.ts มาเป็น proxy.ts)
 *
 * ทำแล้ว:
 *   - บทที่ 5: หน้าลูกค้าที่ต้องมีรอบโต๊ะ (/t/:code/cart, /item, /orders)
 *     ถ้าไม่มี cookie ของ TableSession เลย ให้เด้งกลับไปหน้าเปิดโต๊ะทันที
 *
 *   - บทที่ 9: ทุกหน้าใน /pos ที่ยังไม่มี cookie ของพนักงาน เด้งไปหน้าใส่ PIN
 *
 * ของที่จะมาต่อ:
 *   - บทที่ 13: /kds, /admin + เช็ค RBAC ให้ครบทุกหน้า
 *
 * ข้อควรระวัง: proxy รันก่อน render และอาจถูก deploy ไปอยู่ที่ CDN
 * จึงห้ามพึ่ง shared module / global state และห้าม import Prisma เข้ามาที่นี่
 *
 * ที่นี่จึงเช็คได้แค่ว่า "มี cookie ติดมาไหม" ซึ่งเป็น optimistic check ตามที่
 * docs ของ Next.js แนะนำ (proxy ไม่ใช่ที่สำหรับ session management เต็มรูป)
 * การตรวจจริงว่า token นั้นยังไม่หมดอายุและเป็นของโต๊ะนี้จริง อยู่ที่
 * resolveCustomerContext() ในทุกหน้าและทุก Server Action
 */
const CUSTOMER_SESSION_REQUIRED = /^\/t\/[^/]+\/(cart|item|orders)(\/|$)/;

/**
 * ทุกหน้าใน /pos ต้องมี cookie ของพนักงาน ยกเว้นหน้าใส่ PIN เอง
 * (ถ้าไม่ยกเว้น /pos/login จะ redirect วนไม่จบ)
 *
 * ปิดท้ายด้วย (\/|$) เพื่อไม่ให้ path ที่แค่ขึ้นต้นด้วยคำว่า pos เช่น /poster โดนดักไปด้วย
 */
const STAFF_SESSION_REQUIRED = /^\/pos(?!\/login(\/|$))(\/|$)/;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (CUSTOMER_SESSION_REQUIRED.test(pathname) && !request.cookies.has(TABLE_SESSION_COOKIE)) {
    const tableCode = pathname.split("/")[2];
    return NextResponse.redirect(new URL(`/t/${tableCode}`, request.url));
  }

  if (STAFF_SESSION_REQUIRED.test(pathname) && !request.cookies.has(STAFF_SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/pos/login", request.url));
  }

  return NextResponse.next({
    request: {
      headers: request.headers,
    },
  });
}

export const config = {
  /**
   * ไม่ใส่ matcher = รันทุก request รวมถึงไฟล์ static ด้วย ซึ่งจะทำให้ CSS/JS/รูป
   * โดน auth logic บล็อกโดยไม่ตั้งใจ จึงตัด _next/static, _next/image, favicon
   * และไฟล์ที่มีนามสกุลออกทั้งหมด
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
