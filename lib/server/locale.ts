import "server-only";

import { cookies } from "next/headers";

import { LOCALE_COOKIE } from "@/lib/i18n/cookie";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/locales";
import {
  tCount,
  translate,
  type CountKey,
  type MessageParams,
} from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

export type Translator = {
  locale: Locale;
  t: (key: MessageKey, params?: MessageParams) => string;
  tc: (base: CountKey, n: number, params?: MessageParams) => string;
};

/**
 * ภาษาของ "เครื่องนี้" — cookie เป็นของเครื่อง ไม่ใช่ของคน
 *
 * แท็บเล็ตในครัวตั้งเวียดนาม โน้ตบุ๊กเจ้าของร้านตั้งอังกฤษ และมือถือลูกค้า
 * เลือกเองได้ โดยไม่มีใครไปทับของใคร — ต่างจากการเก็บที่ `Staff` ซึ่งจะทำให้
 * จอ POS ที่สองคนใช้ร่วมกันสลับภาษาทั้งจอทุกครั้งที่มีคนใส่ PIN
 *
 * ค่าที่อ่านไม่ออกตกกลับเป็นค่าตั้งต้นเสมอ **ห้าม throw** — cookie ที่ผู้ใช้
 * แก้มั่วมาต้องไม่ทำให้เปิดหน้าไม่ได้
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;

  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * ตัวแปลสำหรับ server component — `const { t } = await getT();`
 *
 * ⚠ ห้ามเรียกจาก `lib/server/*` ตัวอื่นเด็ดขาด ชั้นธุรกิจต้องคืน **คีย์**
 * ไม่ใช่ประโยค (ดูหัวข้อ 5 ของ spec) เหตุผลสองข้อ: ข้อความ error จะได้ไม่ค้าง
 * อยู่ในภาษาที่เซิร์ฟเวอร์เลือกตอนนั้น และสคริปต์ smoke ที่ไม่มี request
 * context จะได้ยังเรียกชั้นธุรกิจได้อยู่
 */
export async function getT(): Promise<Translator> {
  const locale = await getLocale();
  const dict = DICTIONARIES[locale];

  return {
    locale,
    t: (key, params) => translate(dict, key, params),
    tc: (base, n, params) => tCount(dict, base, n, params),
  };
}
