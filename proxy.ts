import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Proxy (Next.js 16.2 เปลี่ยนชื่อ convention จาก middleware.ts มาเป็น proxy.ts)
 *
 * ตอนนี้ยังเป็นแค่โครง: ปล่อยผ่านทุก request แต่ต่อ matcher ไว้ให้ถูกแล้ว
 *
 * ของที่จะมาต่อในไฟล์นี้:
 *   - บทที่ 5: กัน /t/:tableCode ที่ไม่มี TableSession cookie ที่ยังไม่หมดอายุ
 *     (เคส "ลูกค้าถ่ายรูป QR แล้วกลับไปสั่งจากบ้านอีกหลายวันถัดมา")
 *   - บทที่ 13: กัน /pos, /kds, /admin ที่ยังไม่ผ่าน PIN ของพนักงาน + เช็ค RBAC
 *
 * ข้อควรระวัง: proxy รันก่อน render และอาจถูก deploy ไปอยู่ที่ CDN
 * จึงห้ามพึ่ง shared module / global state และห้าม import Prisma เข้ามาที่นี่
 */
export function proxy(request: NextRequest) {
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\..*).*)"],
};
