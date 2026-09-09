"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/lib/i18n/cookie";
import { isLocale } from "@/lib/i18n/locales";

/**
 * สลับภาษาของเครื่องนี้
 *
 * ⚠ ไฟล์ "use server" export ได้เฉพาะ async function — ชื่อ cookie กับอายุ
 * จึงอยู่ที่ lib/i18n/cookie.ts ไม่ใช่ที่นี่ (กฎเดียวกับ lib/form-state.ts
 * ที่ error จะไม่โผล่ตอน build เลย โผล่ตอนกดปุ่มแล้วได้ 500 ทั้งหน้า)
 *
 * ค่าที่ไม่รู้จักถูกเมินเงียบ ๆ ไม่ throw: ปุ่มสลับภาษาที่ทำให้ทั้งจอพัง
 * แย่กว่าปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) {
    return;
  }

  const store = await cookies();

  store.set(LOCALE_COOKIE, locale, {
    // ไม่มีใครฝั่ง browser ต้องอ่าน cookie นี้ — provider รับภาษามาทาง prop
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
  });

  /**
   * ต้องล้างทั้ง layout ไม่ใช่แค่หน้าเดียว เพราะภาษาถูกอ่านที่ layout ราก
   * ถ้าล้างแค่หน้าปัจจุบันจะได้จอที่หัวเป็นภาษาใหม่แต่เนื้อยังเป็นภาษาเก่า
   */
  revalidatePath("/", "layout");
}
