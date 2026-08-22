# แผนก้อนถัดไป — บทที่ 11: รับเงิน (โหมด demo)

เขียนไว้ 2026-08-22 เพื่อส่งต่อข้าม session · **อ่านไฟล์นี้ก่อนเริ่มเขียนโค้ด**
ต่อจาก `report/2026-08-22-bill-and-currency.md`

---

## 0. ขอบเขตที่ตกลงกับผู้ใช้แล้ว — อ่านก่อนอย่างอื่น

> **"for payment this is only demo maybe cashier can manual click for each order
> (before done order just choose cash or QR payment)"**

แปลว่า:

- ❌ **ไม่ต่อ payment gateway จริง** ไม่มี webhook ไม่มีการยืนยันยอดจากธนาคาร
- ❌ **ไม่ต้องสร้าง PromptPay payload จริงตามมาตรฐาน EMVCo** (เดิม CLAUDE.md
  เขียนไว้ว่าต้องทำ tag 29 — **ยกเลิกข้อนั้นสำหรับก้อนนี้**)
- ✅ แคชเชียร์กดเลือกวิธีชำระเอง: **เงินสด** หรือ **QR** แล้วกดยืนยัน = บิลปิด
- ✅ QR แสดงเป็นภาพ placeholder พร้อมยอดเงิน ไม่ใช่ QR ที่สแกนจ่ายได้จริง
  **ต้องเขียนบนจอให้ชัดว่าเป็นโหมดสาธิต** ไม่ใช่ปล่อยให้เข้าใจผิดว่าจ่ายได้จริง

สิ่งที่ยัง **ต้อง** ทำให้ถูกต้องเต็มรูป แม้จะเป็น demo:
การปิดบิลเป็น transaction เดียว · snapshot อัตรา · AuditLog · ยอดเงินเป็น
จำนวนเต็มล้วน · RBAC — เพราะพวกนี้คือโครงที่บทที่ 12/13/15 จะต่อยอด

---

## 1. สถานะปัจจุบัน (ของที่มีอยู่แล้ว ใช้ได้เลย)

| มีแล้ว | ที่ไหน |
|---|---|
| `calculateBill()` คิดยอดครบทุกโหมด | `lib/bill.ts` |
| `getTableBill(branchId, tableId)` รวมบิลทั้งรอบโต๊ะ | `lib/server/billing.ts` |
| หน้าคิดเงิน (อ่านอย่างเดียว) | `app/(pos)/pos/table/[tableId]/bill/page.tsx` |
| `formatMoney(amount, currency)` รองรับ THB/LAK/VND | `lib/money.ts` |
| pub/sub + SSE | `lib/server/realtime.ts`, `app/api/realtime/route.ts` |
| RBAC ต่อหน้าจอ/ต่อการกระทำ | `lib/rbac.ts` |
| roll-up สถานะบิล | `lib/server/order-progress.ts` |

คอลัมน์ใน `Order` ที่ยังเป็น 0 รอก้อนนี้เติม:
`discountAmount` · `serviceChargeAmount` · `vatAmount` · `grandTotal`
และ `serviceChargeBp` / `vatRateBp` / `pricesIncludeVat` ที่ยังเป็น null

---

## 2. การตัดสินใจเชิงออกแบบที่ต้องทำก่อนเขียนโค้ด

### 2.1 ต้องมีตาราง `Payment` ใหม่ ไม่ใช่ยัดทุกอย่างลง `Order`

**ปัญหา:** บิลคิดที่ระดับ "รอบโต๊ะ" (รวม subtotal ของทุก Order ก่อน แล้วคิด
เซอร์วิสชาร์จ/VAT ครั้งเดียว — ดูเหตุผลใน `billing.ts`) แต่คอลัมน์ยอดเงินอยู่ที่
ระดับ `Order` ซึ่งมีได้หลายใบต่อรอบ

**ทางแก้ที่เลือก:** เพิ่มโมเดล `Payment` เก็บยอดระดับรอบโต๊ะเป็นตัวจริง
แล้ว `Order` เก็บส่วนแบ่งของตัวเอง (ดู 2.2)

ตารางนี้จำเป็นอยู่แล้วสำหรับบทที่ 12 (ใบกำกับภาษีที่ต้องมีเลขที่เดินต่อเนื่อง)
จึงไม่ใช่การทำเผื่อ

```prisma
enum PaymentMethod {
  CASH
  QR      /// โหมด demo — ไม่ได้ยืนยันกับธนาคารจริง
  CARD    /// ยังไม่เปิดใช้ในก้อนนี้ ใส่ไว้ให้ enum ครบ
}

model Payment {
  id             String  @id @default(cuid())
  branchId       String
  tableSessionId String

  method   PaymentMethod
  /// snapshot สกุลเงิน ณ เวลาที่จ่าย — ห้ามอ่านจาก Branch ตอนพิมพ์ย้อนหลัง
  currency Currency

  // ── ยอดเงิน: Int หน่วยย่อยที่สุดของสกุลเงินนั้น (ดู lib/money.ts) ──
  subtotal            Int
  discountAmount      Int @default(0)
  serviceChargeAmount Int
  vatAmount           Int
  netAmount           Int
  grandTotal          Int

  /// เงินสดที่รับมาจริง (null เมื่อจ่าย QR) — ใช้คำนวณเงินทอน
  receivedAmount Int?
  changeAmount   Int?

  // snapshot อัตรา
  serviceChargeBp  Int
  vatRateBp        Int
  pricesIncludeVat Boolean

  paidByStaffId String?
  paidAt        DateTime @default(now())
  createdAt     DateTime @default(now())

  branch       Branch       @relation(fields: [branchId], references: [id], onDelete: Cascade)
  tableSession TableSession @relation(fields: [tableSessionId], references: [id], onDelete: Restrict)
  paidByStaff  Staff?       @relation(fields: [paidByStaffId], references: [id], onDelete: SetNull)
  orders       Order[]

  @@index([branchId, paidAt])
  @@index([tableSessionId])
  @@map("payments")
}
```

`Order` เพิ่ม `paymentId String?` + relation (onDelete: SetNull ไม่ได้ — ใช้ Restrict
เพราะบิลที่จ่ายแล้วห้ามลบการจ่ายทิ้ง)

> ⚠ **migration:** ถ้าต้องแปลงชนิดคอลัมน์เดิม ให้ใช้ `--create-only` แล้วอ่าน SQL
> ก่อนเสมอ (บทเรียนจากก้อนสกุลเงิน — generator เลือก DROP+CREATE แล้วข้อมูลหาย)
> ก้อนนี้เป็นการ **เพิ่ม** ตาราง/คอลัมน์ล้วน จึงน่าจะปลอดภัย แต่ยังต้องอ่าน SQL อยู่ดี
> และ `prisma migrate dev` เป็นคำสั่ง interactive → ใช้ `--create-only` แล้ว
> `prisma migrate deploy`

### 2.2 กระจายยอดลงแต่ละ Order ด้วย largest remainder

`Payment.grandTotal` คือตัวจริง แต่ `Order` แต่ละใบต้องมียอดของตัวเองด้วย
เพราะรายงานบทที่ 15 ต้องแยกยอดตาม `channel` (ลูกค้าสั่งเอง vs พนักงานสั่ง)
และตาม `placedByStaffId`

**ห้ามคิดเซอร์วิสชาร์จ/VAT ใหม่ทีละใบ** เพราะจะปัดเศษหลายรอบแล้วผลรวมไม่ตรงกับ
ยอดที่ลูกค้าจ่ายจริง (เคสทดสอบใน `smoke:bill` พิสูจน์ไว้แล้วว่าต่างกันจริง)

ให้เขียนฟังก์ชันใหม่ใน `lib/bill.ts`:

```ts
/** แบ่งยอดก้อนหนึ่งตามสัดส่วน subtotal ของแต่ละบิล โดยผลรวมต้องเท่าเดิมเป๊ะ */
export function distributeByWeight(total: number, weights: number[]): number[]
```

วิธี largest remainder: หารตามสัดส่วนแล้วปัดลงก่อน จากนั้นแจกเศษที่เหลือทีละ 1
ให้ใบที่มีเศษมากสุดเรียงลงมา

**invariant ที่ต้องมีเคสทดสอบ:** `sum(ผลลัพธ์) === total` เสมอ ทุกกรณี
รวมถึงกรณี weights เป็น 0 ทั้งหมด และกรณี total = 0

### 2.3 ใครกดรับเงินได้

เพิ่มใน `lib/rbac.ts`:

```ts
/** รับเงินปิดบิลได้ไหม — พนักงานเสิร์ฟกดไม่ได้ (คนถือเงินกับคนเสิร์ฟแยกกัน) */
export function canTakePayment(role: StaffRole): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "CASHIER";
}
```

ชุดเดียวกับ `canCancelOrderItem` — เหตุผลเดียวกันคือแตะเงิน

---

## 3. งานที่ต้องทำ เรียงตามลำดับ

### 3.1 Schema + migration
- [ ] `enum PaymentMethod`, `model Payment`, `Order.paymentId`
- [ ] เพิ่ม relation ที่ `Branch`, `Staff`, `TableSession`
- [ ] `prisma migrate dev --create-only` → อ่าน SQL → `prisma migrate deploy`
- [ ] `prisma generate` + `prisma validate`

### 3.2 ตรรกะ
- [ ] `lib/bill.ts` — เพิ่ม `distributeByWeight()`
- [ ] `lib/rbac.ts` — เพิ่ม `canTakePayment()`
- [ ] `lib/server/payment.ts` (ใหม่) — `takePayment(staff, tableId, input)`

`takePayment()` ต้องทำทั้งหมดนี้ใน **`prisma.$transaction` เดียว**:

1. โหลดบิลใหม่จาก DB แล้ว **คิดยอดใหม่ฝั่ง server ด้วย `calculateBill()`**
   — ห้ามเชื่อยอดที่ client ส่งมาเด็ดขาด (client ส่งมาแค่ "วิธีจ่าย" กับ
   "รับเงินสดมาเท่าไหร่")
2. กันจ่ายซ้ำ: `updateMany` ที่มีเงื่อนไข `status: { in: [...ยังไม่จ่าย] }`
   ถ้า `count === 0` แปลว่ามีคนจ่ายไปแล้ว → คืน `ok: true` ไม่ใช่ error
   (ท่าเดียวกับ `placeOrder()` ใน `cart.ts`)
3. สร้าง `Payment`
4. อัปเดตทุก `Order` ในรอบ: `status = PAID`, `paidAt`, `paymentId`,
   ยอดที่แบ่งด้วย `distributeByWeight()`, และ snapshot อัตราทั้งสามค่า
5. ปิด `TableSession` (`status = CLOSED`, `closedAt`)
6. `RestaurantTable.status = AVAILABLE`
7. `AuditLog` action `"payment.take"` พร้อม metadata: วิธีจ่าย ยอด จำนวนบิล

หลัง commit แล้วค่อย `publishRealtimeEvent()` (**ห้ามเรียกใน transaction**)

**เงื่อนไขที่ต้องกันไว้:**
- บิลว่าง (ไม่มีรายการ) → จ่ายไม่ได้
- เงินสดที่รับมา < ยอดที่ต้องจ่าย → error ("รับเงินมาไม่พอ")
- เงินทอน = `receivedAmount - grandTotal` (จำนวนเต็มล้วน)
- ของที่ยังไม่เสิร์ฟ → **เตือนแต่ไม่ห้าม** (ลูกค้าขอจ่ายก่อนได้)

### 3.3 Realtime
- [ ] `lib/realtime-events.ts` — เพิ่ม `"payment.completed"` เข้า `RealtimeEventType`
- [ ] ยิง event หลังปิดบิล → ผังโต๊ะเห็นโต๊ะว่างเองทันที

### 3.4 หน้าจอ
- [ ] `app/(pos)/pos/table/[tableId]/bill/page.tsx` — เพิ่มส่วนรับเงิน
  - ปุ่มเลือกวิธี: **เงินสด** / **QR** (segmented control ใช้คลาส `.is-active`)
  - เงินสด: ช่องกรอกเงินที่รับมา + ปุ่มลัดยอดกลม ๆ + แสดงเงินทอนสด ๆ
  - QR: กล่อง placeholder + ยอดเงิน + **ป้ายบอกว่าเป็นโหมดสาธิต**
  - ปุ่มยืนยัน (`SubmitButton` กันกดรัว) — ซ่อนถ้า `!canTakePayment(role)`
- [ ] หน้าหลังจ่ายเสร็จ: สรุปยอด + เงินทอน + ปุ่มกลับผังโต๊ะ
      (ใบเสร็จจริงเป็นบทที่ 12)
- [ ] `app/(pos)/pos/actions.ts` หรือไฟล์ action ใหม่ — `takePaymentAction`
- [ ] `pos-sidebar.tsx` — โมดูล 03 ยังไม่มีหน้าเดี่ยว (ต้องมีโต๊ะก่อน)
      เปลี่ยน `todo` เป็น `"บทที่ 12"` หรือปล่อยไว้

**responsive:** ทำตามแพตเทิร์นเดิม — `xl` แยกสองแพเนล, จอแคบเลื่อนหน้าเดียว
และ **ห้ามใช้คลาส design system (`ink-row`/`panel`/`btn`) คู่กับ `hidden`/`lg:flex`**
(specificity 0-2-0 ชนะ utility — ดู `report/2026-08-22-responsive-screens.md` §3.1)

### 3.5 ทดสอบ
- [ ] `scripts/smoke-payment.ts` + `"smoke:payment"` ใน package.json
      ใช้โต๊ะ **A3** (A1=order, A2=kds, B1=pos, B2=bill)

เคสที่ต้องมี:
- `distributeByWeight` ผลรวมเท่าเดิมเป๊ะ (รวมเคสเศษเยอะ ๆ เช่น 3 ใบ ยอด 100)
- `sum(order.grandTotal) === payment.grandTotal`
- จ่ายเงินสดพอดี / เกิน (มีเงินทอน) / ไม่พอ (error)
- จ่ายซ้ำสองครั้งพร้อมกัน → ได้ `Payment` ใบเดียว
- หลังจ่าย: order เป็น PAID · session CLOSED · โต๊ะ AVAILABLE
- snapshot อัตราถูกเขียนลง Order และ Payment ครบ
- พนักงานเสิร์ฟกดจ่าย → error
- บิลว่างจ่ายไม่ได้
- ยอดที่บันทึกตรงกับ `calculateBill()` ทุกสกุลเงิน (อย่างน้อย THB + VND)
- [ ] รัน `smoke:order` `smoke:pos` `smoke:kds` `smoke:bill` ให้ผ่านครบ
      (การเปลี่ยนสถานะเป็น PAID อาจกระทบ `getPosTables` / `getTableBill`)
- [ ] audit ล้นแนวนอน 4 ความกว้างด้วยสคริปต์ CDP (ดู §4 ด้านล่าง)

### 3.6 เอกสาร
- [ ] `report/2026-08-22-chapter-11-payment.md`
- [ ] อัปเดต `CLAUDE.md` §6 (เพิ่มหัวข้อบทที่ 11) และ §7 (ชี้ไปบทที่ 12)

---

## 4. คำสั่งที่ใช้บ่อย

```bash
npm run dev                      # ถ้าขึ้น "Another next dev server" = มีตัวเก่ารันอยู่แล้ว
npm run smoke:order              # 21 เคส
npm run smoke:pos                # 58 เคส
npm run smoke:kds                # 55 เคส  (REALTIME_DRIVER=postgres ได้ 56)
npm run smoke:bill               # 43 เคส
npm run dev:staff-cookie 002     # cookie แคชเชียร์ (POS)  — 001 เจ้าของ, 003 เสิร์ฟ, 004 ครัว
npm run dev:session a1x7qk       # cookie ลูกค้าของโต๊ะ A1
REALTIME_DRIVER=postgres npm run dev:emit order.placed
npx tsc --noEmit && npx eslint && npm run build
```

**สคริปต์ audit ล้นแนวนอน** อยู่ใน scratchpad ของ session ก่อน (ไม่ได้ commit)
ถ้าต้องใช้อีกให้เขียนใหม่ — วิธี: เปิด Chrome ด้วย
`--headless=new --remote-debugging-port=9222` แล้วคุย CDP ผ่าน `WebSocket`
ที่มีใน Node 24 (ไม่ต้องลง puppeteer) → `Network.setCookie` →
`Emulation.setDeviceMetricsOverride` → `Runtime.evaluate` วัด
`documentElement.scrollWidth > innerWidth` → `Page.captureScreenshot`
Chrome อยู่ที่ `C:/Program Files/Google/Chrome/Application/chrome.exe`

---

## 5. กฎที่ห้ามพลาด (สรุปจากทุกก้อนที่ผ่านมา)

1. **เงินเป็นจำนวนเต็มหน่วยย่อยที่สุดของสกุลเงินสาขา** ห้ามหาร 100 นอก
   `lib/money.ts` ห้ามเขียน "฿" ลงจอตรง ๆ — ใช้ `formatMoney(amount, currency)`
2. **แก้หลายตารางพร้อมกัน = `$transaction` จริง** ไม่ใช่เรียกทีละคำสั่ง
3. **`publishRealtimeEvent()` เรียกหลัง commit เท่านั้น**
4. **ทุก Server Action ตรวจสิทธิ์เองบรรทัดแรก** การซ่อนปุ่มไม่ใช่การกันสิทธิ์
5. **ไฟล์ `"use server"` export ได้เฉพาะ async function**
6. **คลาส design system + `hidden`/`lg:flex` = ไม่ทำงาน** (specificity)
7. **`getCurrentStaff("pos")` ต้องระบุหน้าจอเสมอ** — cookie แยกใบต่อจอ
8. **ห้ามเชื่อยอดเงินที่ client ส่งมา** คิดใหม่ฝั่ง server ทุกครั้ง
9. เนื้อหาภาษี **ไม่ใช่คำแนะนำทางกฎหมาย** ต้องให้ผู้สอบบัญชีตรวจก่อนใช้จริง

---

## 6. หลังบทที่ 11 เหลืออะไร

| บท | เรื่อง | หมายเหตุ |
|---|---|---|
| 12 | ใบเสร็จ / ใบกำกับภาษีอย่างย่อ | เลขที่ต้องเดินต่อเนื่อง — ต่อยอดจาก `Payment` |
| 13 | RBAC เต็ม + audit + หน้าหลังร้าน | ปุ่มส่วนลด (สูตรพร้อมแล้ว) ต้องมาที่บทนี้ |
| 14 | สต็อกวัตถุดิบ | เริ่มจากรุ่นเรียบง่าย |
| 15 | รายงาน ปิดกะ ปิดวัน | X/Z report |
| 16 | Deploy | ตั้ง `REALTIME_DRIVER=postgres` · แคบ `images.remotePatterns` |

**งานค้างที่สะสมอยู่ (ไม่ผูกกับบทไหน แต่ต้องเก็บก่อน deploy):**
- ตัวนับ PIN ผิดยังอยู่ใน memory ของ process → ย้ายไป Postgres/Redis
- ยกเลิก session ทันทีไม่ได้ → ต้องมีตาราง `StaffSession`
- ย้าย/รวมโต๊ะ + แยกบิล ยังไม่ได้ทำ (ค้างจากบทที่ 9)
- ยังไม่ได้ตรวจ responsive แนวนอนบนมือถือ (landscape)
