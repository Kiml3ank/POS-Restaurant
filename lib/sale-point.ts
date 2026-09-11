import type { BillRates } from "@/lib/bill";
import type { OrderType, SalePointKind } from "@/lib/generated/prisma/enums";
import type { MessageParams } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

/**
 * ตัวแปลที่ผู้เรียกส่งเข้ามา — server component ได้จาก `getT()`
 * ส่วน client component ได้จาก `useT()`
 *
 * ไฟล์นี้ **ไม่อ่าน cookie เอง** โดยตั้งใจ: มันถูกเรียกจากทั้งสองฝั่ง และจาก
 * สคริปต์ smoke ที่ไม่มี request context เลย — รับตัวแปลเข้ามาจึงเป็นทางเดียว
 * ที่ยังคงเป็น "ที่เดียวในระบบ" ได้โดยไม่ผูกกับ Next.js
 */
type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * กติกาของ "จุดขาย" — ที่เดียวในระบบที่ตอบว่าช่องทางไหนทำอะไรได้บ้าง
 *
 * ── ทำไมกติกาผูกกับ "จุดขาย" ไม่ใช่กับ "บิล" ────────────────────────────
 * จุดขาย = แถวใน `RestaurantTable` (โต๊ะนั่ง / เคาน์เตอร์ซื้อกลับ / ช่องไรเดอร์)
 * ส่วนบิลคือ `TableSession` ที่เปิดบนจุดขายนั้น — กติกาสี่ข้อด้านล่างตัดสินได้
 * ตั้งแต่รู้ว่าเปิดบิลที่ไหน **ก่อน** ที่บิลจะมีของอยู่ในนั้นด้วยซ้ำ จึงต้องอยู่ที่จุดขาย
 *
 * ── ทำไมต้องเป็นไฟล์นี้ไฟล์เดียว ────────────────────────────────────────
 * เพราะกติกาเดียวกันถูกถามจากสี่ที่ที่ห่างกันมาก: ตอนเปิดบิล
 * (`table-session.ts`) ตอนคิดเงิน (`billing.ts`) ตอนรับเงิน (`payment.ts`)
 * และตอนวาดผังโต๊ะ (`pos.ts`) — ถ้ากระจาย `kind === "DINE_IN"` ไว้ทั่วโค้ด
 * วันที่เพิ่มช่องทางที่ห้า จะมีบางที่ที่ลืมแก้ แล้วจะเป็นบั๊กเรื่องเงิน
 * (เหตุผลเดียวกับที่ `lib/rbac.ts` รวมตารางสิทธิ์ไว้ที่เดียว)
 *
 * ไม่มี `import "server-only"` เพราะหน้าจอต้องใช้ตัดสินว่าจะโชว์ป้ายช่องทางไหน
 */

/**
 * ช่องทางของบิลที่เปิดบนจุดขายแต่ละชนิด
 *
 * **`Order.type` ต้องมาจากตารางนี้เท่านั้น ห้ามให้หน้าจอส่งค่ามาเอง** เพราะมันคือ
 * ตัวชี้ว่าบิลนี้คิดเซอร์วิสชาร์จหรือไม่ ถ้าหน้าจอส่งได้ = ใครก็ยิง POST เปลี่ยน
 * บิลโต๊ะให้เป็น TAKEAWAY เพื่อตัดค่าบริการ 10% ทิ้งได้ (ดู schema.prisma)
 *
 * เป็น Record เต็ม ไม่ใช่ switch ที่มี default — เพิ่มค่าใน enum แล้วลืมแก้ที่นี่
 * tsc จะฟ้องทันที ไม่ใช่เงียบแล้วตกไปที่ค่าใดค่าหนึ่ง
 */
export const ORDER_TYPE_FOR_SALE_POINT: Record<SalePointKind, OrderType> = {
  DINE_IN: "DINE_IN",
  COUNTER: "TAKEAWAY",
  DELIVERY: "DELIVERY",
};

/** คีย์ป้ายของแต่ละช่องทาง — ใช้บนผังโต๊ะ, ตั๋วครัว (KDS) และใบเสร็จ */
export function salePointKey(kind: SalePointKind): MessageKey {
  return `salePoint.${kind}`;
}

/**
 * ชื่อที่ใช้เรียกบิลใบหนึ่งบนหน้าจอ กระดาษ และตั๋วครัว — **ที่เดียวในระบบ**
 *
 * ── ปัญหาที่ฟังก์ชันนี้แก้ ────────────────────────────────────────────────
 * ก่อนมีช่องทางซื้อกลับ ทุกบิลอยู่บนโต๊ะ โค้ดทั่วระบบจึงเขียน `table.name` ตรง ๆ
 * แล้วแปะคำว่า "โต๊ะ" ไว้ข้างหน้า พอมีเคาน์เตอร์ ผลที่ออกมาคือ:
 *
 *     โต๊ะ: เคาน์เตอร์ซื้อกลับ      ← บนใบเสร็จ
 *     เคาน์เตอร์ซื้อกลับ            ← บนตั๋วครัว (ครัวอ่านแล้วไม่รู้ว่าของใคร)
 *
 * ทั้งสองอันผิดคนละแบบ: อันแรกเรียกสิ่งที่ไม่ใช่โต๊ะว่าโต๊ะ อันที่สองบอก
 * **ชื่อช่อง** แทนที่จะบอก **ว่าเป็นบิลของใคร** ซึ่งที่เคาน์เตอร์คือเลขคิว
 * (ชื่อช่องไม่มีประโยชน์เลยเพราะร้านมีเคาน์เตอร์เดียว แต่มีลูกค้าหลายคน)
 *
 * เลขคิวจึงมาก่อนชื่อจุดขายเสมอสำหรับช่องทางที่ไม่ใช่โต๊ะนั่ง — ตกกลับไปใช้
 * ชื่อจุดขายเฉพาะตอนที่ไม่มีเลขคิวจริง ๆ (ข้อมูลเก่าก่อนมีคอลัมน์นี้)
 */
export function salePointDisplayName(
  table: { name: string; kind: SalePointKind },
  session: { queueNumber?: number | null } | null | undefined,
  t: Translate,
): string {
  if (showsInTableMap(table.kind)) {
    return t("salePoint.tableNamed", { name: table.name });
  }

  const channel = t(salePointKey(table.kind));
  const queueNumber = session?.queueNumber;

  return queueNumber
    ? t("salePoint.queued", { channel, queue: queueNumber })
    : t("salePoint.channelNamed", { channel, name: table.name });
}

/**
 * เส้นทางฐานของจุดขายบนจอ POS — **ที่เดียวที่ตัดสินว่าบิลนี้อยู่ URL ตระกูลไหน**
 *
 * โต๊ะนั่งชี้ด้วย tableId (โต๊ะหนึ่งมีบิลเปิดได้ใบเดียว) ส่วนช่องทางที่เปิดพร้อมกัน
 * ได้หลายบิลต้องชี้ด้วย sessionId ไม่งั้นลิงก์เดียวกันพาไปคนละบิลตามเวลาที่กด
 *
 * เดิมกฎนี้เป็นฟังก์ชันส่วนตัวใน `app/(pos)/pos/actions.ts` ซึ่งไฟล์ "use server"
 * export ค่าที่ไม่ใช่ async function ออกมาไม่ได้ หน้าอื่น (เช่นหน้าใบเสร็จ)
 * จึงเขียน `/pos/table/<id>` เองแล้วพาพนักงานไป URL ตระกูลผิดของบิลซื้อกลับ
 */
export function salePointBasePath(
  table: { id: string; kind: SalePointKind },
  session: { id: string },
): string {
  return showsInTableMap(table.kind) ? `/pos/table/${table.id}` : `/pos/counter/${session.id}`;
}

/**
 * ป้ายของ "ช่องข้อมูล" ที่บอกว่าบิลนี้มาจากไหน — ใช้บนใบเสร็จและตารางที่มีหัวคอลัมน์
 *
 * แยกจาก `salePointDisplayName()` เพราะบางที่ต้องการป้ายกับค่าแยกกัน
 * (`<dt>โต๊ะ</dt><dd>A1</dd>`) ซึ่งเขียนว่า "โต๊ะ" ตายตัวไม่ได้อีกต่อไป
 */
export function salePointFieldLabel(kind: SalePointKind, t: Translate): string {
  return t(showsInTableMap(kind) ? "salePoint.fieldTable" : "salePoint.fieldChannel");
}

/**
 * จุดขายนี้ขึ้นผังโต๊ะที่ `/pos` ไหม
 *
 * เฉพาะโต๊ะนั่ง — เพราะผังโต๊ะตอบคำถามว่า "โต๊ะไหนว่าง" ซึ่งเคาน์เตอร์ตอบไม่ได้
 * (เคาน์เตอร์มีบิลเปิดพร้อมกันได้หลายใบ คำว่า "ไม่ว่าง" จึงไม่มีความหมาย)
 * บิลซื้อกลับที่ยังไม่ปิดแสดงเป็น "แถบคิว" แยกต่างหาก ไม่ใช่ช่องในผัง
 */
export function showsInTableMap(kind: SalePointKind): boolean {
  return kind === "DINE_IN";
}

/**
 * เปิดบิลใหม่บนจุดขายนี้แล้ว "เข้าร่วม" บิลที่เปิดค้างอยู่ไหม
 *
 * **เฉพาะโต๊ะนั่ง** — สี่คนที่นั่งโต๊ะเดียวกันสแกน QR สี่เครื่องต้องได้บิลใบเดียว
 * (กฎตั้งแต่บทที่ 5) แต่เคาน์เตอร์ไม่ใช่ที่ที่คนนั่งลงด้วยกัน: ลูกค้าซื้อกลับ
 * สองคนที่ต่อคิวติดกัน **ต้องได้คนละบิล** ถ้าเข้าร่วมบิลเดิมคนที่สองจะจ่ายค่าข้าว
 * ของคนแรกด้วย ซึ่งพังตั้งแต่ชั่วโมงแรกที่เปิดร้าน
 */
export function joinsExistingSession(kind: SalePointKind): boolean {
  return kind === "DINE_IN";
}

/**
 * บิลของจุดขายนี้ต้องมีเลขคิวไหม
 *
 * ทุกจุดขายที่ไม่ใช่โต๊ะนั่ง — เพราะไม่มีชื่อโต๊ะให้เรียกลูกค้ามารับของ
 * เลขคิวเป็นคนละเรื่องกับเลขที่ใบกำกับภาษี: รีเซ็ตทุกวัน, ขาดหายได้,
 * และต้องสั้นพอที่จะตะโกนเรียก ("คิว 12") — ห้ามเอา `DocumentCounter`
 * ของบทที่ 12 มาใช้ซ้ำ เพราะตัวนั้นห้ามรีเซ็ตตลอดกาล
 */
export function needsQueueNumber(kind: SalePointKind): boolean {
  return kind !== "DINE_IN";
}

/**
 * บิลของจุดขายนี้คิดเซอร์วิสชาร์จไหม
 *
 * **เฉพาะโต๊ะนั่ง** — เซอร์วิสชาร์จคือค่า "บริการที่โต๊ะ" (รับออร์เดอร์ ยกเสิร์ฟ
 * เก็บโต๊ะ) ของที่ลูกค้ามารับเองที่เคาน์เตอร์แล้วเดินออกไปไม่มีบริการส่วนนั้น
 * ร้านส่วนใหญ่จึงไม่เก็บ และการเก็บทั้งที่ไม่มีบริการคือการเก็บเงินเกิน
 *
 * ⚠ ถ้าวันหนึ่งเจ้าของร้านอยากเก็บกับซื้อกลับด้วย **ห้ามแก้ที่นี่ให้คืน true**
 * ต้องเพิ่มคอลัมน์ที่ `Branch` แล้วให้ `billRatesForSalePoint()` อ่านจากตรงนั้น
 * — ไม่งั้นทุกสาขาทุก tenant จะเปลี่ยนตามพร้อมกันโดยไม่มีใครสั่ง
 */
export function chargesServiceCharge(kind: SalePointKind): boolean {
  return kind === "DINE_IN";
}

/**
 * อัตราที่ใช้คิดบิลของจุดขายนี้ — **ที่เดียวที่แปลง "อัตราของสาขา" เป็น "อัตราของบิล"**
 *
 * ทั้ง `getTableBill()` (บทที่ 10) และ `takePayment()` (บทที่ 11) ต้องเรียกตัวนี้
 * ห้ามหยิบ `branch.serviceChargeBp` ไปใช้ตรง ๆ อีก — ถ้าสองที่ไม่ตรงกันเมื่อไหร่
 * ยอดที่แคชเชียร์อ่านให้ลูกค้าฟังจะไม่เท่ากับยอดที่ตัดจริง แล้ว `expectedTotal`
 * จะไม่ตรงจนปิดบิลไม่ได้เลยทั้งวัน (กันไว้ด้วยเคสใน smoke:takeaway)
 *
 * คืน object ใหม่เสมอ ไม่แก้ของที่รับเข้ามา เพราะผู้เรียกบางที่ส่ง `branch`
 * ที่ยัง reuse ต่อในบรรทัดถัดไป
 */
export function billRatesForSalePoint(kind: SalePointKind, branchRates: BillRates): BillRates {
  return {
    ...branchRates,
    serviceChargeBp: chargesServiceCharge(kind) ? branchRates.serviceChargeBp : 0,
  };
}
