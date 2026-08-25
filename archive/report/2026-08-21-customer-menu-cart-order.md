# รายงานความคืบหน้า — 2026-08-21

**ก้อนที่ทำ:** หัวข้อ 5 ข้อ 3 ของ `CLAUDE.md` = **บทที่ 5-7** (หน้าเมนูลูกค้า + ตะกร้า + ส่งออร์เดอร์
รวมชั้น TableSession ของบทที่ 5 ที่ต้องมีก่อนถึงจะมีตะกร้าได้)

**สถานะ:** เสร็จและทดสอบแล้ว ✅ — ผ่าน `tsc --noEmit`, `eslint`, `npm run build`
และทดสอบกับฐานข้อมูล dev จริงครบ 21 เคส (`npm run smoke:order`) + ขับทั้งเส้นทางผ่าน HTTP จริง 10 ขั้น (หัวข้อ 3.1)

---

## 1. สิ่งที่ทำไปแล้ว

### เส้นทางของลูกค้า (ใช้งานได้จริงทั้งเส้น)

```
/t/[tableCode]                    หน้าเปิดโต๊ะ (ถ้ายังไม่มีรอบ) → หน้าเมนู
  └─ /t/[tableCode]/item/[itemId] เลือกตัวเลือก + จำนวน + หมายเหตุ → ใส่ตะกร้า
       └─ /t/[tableCode]/cart     ตะกร้า: เพิ่ม/ลด/ลบ → กดส่งเข้าครัว
            └─ /t/[tableCode]/orders  ติดตามสถานะรายรายการ
```

### ไฟล์ที่เพิ่มใหม่

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/money.ts` | คิด/แสดงเงินเป็นจำนวนเต็มสตางค์ (`formatBaht`, `formatPriceDelta`, `lineTotalOf`) |
| `lib/order-status.ts` | ป้ายภาษาไทยของทุกสถานะ + ตาราง transition ที่อนุญาต (`canTransitionOrder`) |
| `lib/table-session-cookie.ts` | ชื่อ cookie ค่าเดียว แชร์ระหว่าง `proxy.ts` กับ `lib/server/*` |
| `lib/server/table-session.ts` | เปิด/เข้าร่วมรอบโต๊ะ, อ่าน cookie, `resolveCustomerContext()` |
| `lib/server/menu.ts` | ดึงเมนูสามชั้นครั้งเดียวจบ กรอง `isAvailable` ทุกชั้น |
| `lib/server/cart.ts` | ตะกร้า (Order DRAFT), ใส่/แก้/ลบรายการ, ส่งเข้าครัว, ออกเลขบิล |
| `app/(customer)/t/[tableCode]/actions.ts` | Server Action ทั้ง 4 ตัวของหน้าจอลูกค้า |
| `app/(customer)/t/[tableCode]/_components/*` | client component 5 ตัว (ดูหัวข้อ 2.3) |
| `app/(customer)/t/[tableCode]/item/[itemId]/page.tsx` | หน้ารายละเอียดเมนู |
| `app/(customer)/t/[tableCode]/cart/page.tsx` | หน้าตะกร้า |
| `app/(customer)/t/[tableCode]/orders/page.tsx` | หน้าติดตามออร์เดอร์ |
| `scripts/smoke-customer-order.ts` | สคริปต์ทดสอบตรรกะตะกร้ากับ DB จริง 21 เคส |
| `scripts/dev-open-session.ts` | เปิดรอบโต๊ะ + พิมพ์ token ไว้ทดสอบด้วย curl |
| `scripts/dev-reset-table.ts` | ล้างรอบโต๊ะ+บิลของโต๊ะนั้น ให้เริ่มทดสอบใหม่จากโต๊ะว่าง |
| `app/(customer)/t/[tableCode]/form-state.ts` | `FormState` + `IDLE_FORM_STATE` (แยกจาก `actions.ts` — ดูหัวข้อ 3.1) |
| `report/` | โฟลเดอร์รายงานนี้ |

### ไฟล์ที่แก้

- `app/(customer)/t/[tableCode]/page.tsx` — จากหน้าโครงเปล่า เป็นหน้าเมนูจริง
- `proxy.ts` — เพิ่ม optimistic guard ของ route ลูกค้าที่ต้องมีรอบโต๊ะ
- `next.config.ts` — เปิด `images.remotePatterns` ให้ `next/image` ใช้กับรูปเมนูได้
- `package.json` — เพิ่ม `smoke:order`, `dev:session`, `dev:reset-table`
- `CLAUDE.md` — อัปเดตหัวข้อ 6 (สถานะ) และหัวข้อ 7 (ขั้นถัดไป)

---

## 2. การตัดสินใจเชิงออกแบบที่ต้องรู้ก่อนเขียนบทถัดไป

### 2.1 หนึ่งโต๊ะ = หนึ่งรอบ = หนึ่งตะกร้า

`openTableSession()` จะ **เข้าร่วมรอบที่เปิดค้างอยู่ของโต๊ะนั้น** ถ้ามี ไม่สร้างรอบใหม่
สี่คนที่โต๊ะเดียวกันสแกน QR สี่เครื่องจึงเห็นตะกร้าใบเดียวกันและได้บิลใบเดียว
(ทางเลือกอีกทางคือแยกตะกร้าต่อเครื่อง แต่จะเช็คบิลรวมยาก และไม่ตรงกับ `Order.tableSessionId`
ที่ออกแบบไว้ใน schema)

อายุรอบ = 3 ชั่วโมง และ **ตั้งใจไม่ต่ออายุอัตโนมัติ** ตอนสั่งเพิ่ม เพราะถ้าต่อเรื่อย ๆ
รอบที่ลืมปิดจะไม่มีวันหมดอายุ ซึ่งย้อนกลับไปเป็นช่องโหว่ "ถ่ายรูป QR ไปสั่งจากบ้าน" เดิม
→ บทที่ 9 ต้องมีปุ่มให้พนักงานปิดรอบ/เปิดรอบใหม่จากหน้า POS

### 2.2 ด่านตรวจสิทธิ์มีด่านเดียว

`resolveCustomerContext(tableCode)` คืน `session = null` ทั้ง 3 กรณี: ไม่มี cookie /
รอบหมดอายุหรือถูกปิด / cookie เป็นของโต๊ะอื่น — ทุกหน้าและทุก Server Action ของลูกค้า
เรียกฟังก์ชันนี้ก่อนเสมอ **ห้ามเชื่อว่า proxy กรองมาให้แล้ว** เพราะ Server Action
ถูกยิงตรงด้วย POST ได้โดยไม่ผ่านหน้าจอเรา (docs ของ Next.js เตือนไว้ตรง ๆ)

### 2.3 client component มีเท่าที่จำเป็นจริง ๆ

หน้าเมนู/ตะกร้า/ติดตามออร์เดอร์เป็น Server Component ทั้งหมด ที่เป็น client มีแค่ 5 ตัว:
`submit-button` (useFormStatus), `open-session-form`, `add-to-cart-form` (ราคาต้องขยับ
ตามตัวเลือกทันที), `cart-line-controls`, `place-order-form`

### 2.4 กันกดส่งซ้ำ 2 ชั้น

1. **ชั้นหน้าจอ** — `SubmitButton` ปิดตัวเองทันทีที่กดด้วย `useFormStatus` (กัน "กดรัว")
2. **ชั้นฐานข้อมูล (ชั้นที่เชื่อถือได้จริง)** — `placeOrder()` ใช้ `updateMany` ที่มีเงื่อนไข
   `status: "DRAFT"` ติดอยู่ Postgres จะให้คำสั่งที่สองรอ row lock แล้วเช็คเงื่อนไขใหม่
   ได้ `count = 0` แปลว่ามีคนส่งไปแล้ว

   **ถ้ากดซ้ำแล้วบิลถูกส่งไปแล้ว ระบบคืน "สำเร็จ" ไม่ใช่ error** (ทั้งกรณีที่ยังอ่านเจอบิล
   DRAFT และกรณีที่อ่านไม่เจอแล้ว) เพราะการขึ้น error ว่า "ตะกร้าว่าง" จะทำให้ลูกค้าตกใจ
   แล้วสั่งซ้ำอีกใบ ซึ่งแย่กว่าเดิม — เคสนี้เจอจริงตอนรัน smoke test แล้วแก้ตามนั้น

### 2.5 เงินและเลขบิล

- ทุกจำนวนเงินเป็น `Int` หน่วยสตางค์ ไม่มี float โผล่ที่ไหนเลย
- ตอนนี้เติมเฉพาะ `Order.subtotal` — `serviceChargeAmount` / `vatAmount` / `grandTotal`
  **ตั้งใจปล่อยเป็น 0** รอ `calculateBill` ในบทที่ 10 (ดีกว่าใส่ค่าครึ่ง ๆ ให้หน้าจออื่นอ่านผิด)
  หน้าตะกร้าจึงเขียนกำกับไว้ว่า "ยังไม่รวมเซอร์วิสชาร์จและ VAT"
- `orderNumber` = `YYYYMMDD-NNNN` ต่อสาขาต่อวัน ตาม timezone ของสาขา
  ออกเลขตั้งแต่ตอนเปิดตะกร้า **จึงมีเลขกระโดดได้ถ้าลูกค้าทิ้งตะกร้า** —
  เลขที่ต้องต่อเนื่องจริง ๆ ตามกฎหมายคือเลขใบกำกับภาษี ซึ่งเป็นคนละตัวและอยู่ในบทที่ 12

---

## 3. ผลการทดสอบ

```
npx tsc --noEmit      → ผ่าน ไม่มี error
npx eslint            → ผ่าน ไม่มี warning
npm run build         → ผ่าน (route ลูกค้าทั้ง 4 เป็น ƒ Dynamic ตามที่ตั้งใจ)
npm run smoke:order   → 21 PASS / 0 FAIL
```

เคสที่ smoke test ครอบ: กลุ่ม required ที่ไม่เลือก, ส่ง modifier ข้ามเมนู, รวมบรรทัดซ้ำ,
trim หมายเหตุ, คำนวณ `modifierTotal`/`lineTotal`/`subtotal`, รูปแบบเลขบิล, แก้/ลบบรรทัด,
แก้ตะกร้าข้าม session (ต้องถูกปฏิเสธ), กด `placeOrder` พร้อมกันสองครั้ง, สั่งเพิ่มหลังส่งแล้ว

ทดสอบการเรนเดอร์จริงด้วย dev server + curl: หน้าเมนูไม่มี cookie → หน้าเปิดโต๊ะ,
`/cart` ไม่มี cookie → 307 กลับหน้าโต๊ะ (proxy), tableCode มั่ว → 404, itemId มั่ว → 404,
มี cookie → เห็นเมนู/ตัวเลือก/ตะกร้า/ออร์เดอร์ พร้อมยอดเงินถูกต้องทุกหน้า

### 3.1 ขับทั้งเส้นทางจริงผ่าน HTTP (เหมือนเบราว์เซอร์ที่ปิด JS)

ฟอร์มทุกอันเป็น Server Action ที่ React render ช่อง `$ACTION_*` มาให้ (progressive
enhancement) จึงยิง POST เข้าไปตรง ๆ ได้โดยไม่ต้องมี browser driver — ไล่ครบ 10 ขั้น
ตั้งแต่สแกน QR → เปิดโต๊ะ (ได้ cookie) → เลือกตัวเลือก → ใส่ตะกร้า → กดปุ่ม + ในตะกร้า
→ ส่งเข้าครัว → หน้าติดตามออร์เดอร์ ผลถูกต้องทุกขั้น รวมถึงเคสกด "ส่งเข้าครัว"
พร้อมกันสองครั้งแล้วได้บิลใบเดียว (`20260821-0001`) ยอด ฿230.00

> **บั๊กที่เจอเพราะได้ลองกดจริง (แก้แล้ว):** เดิม `actions.ts` มี
> `export const IDLE_FORM_STATE` ปนอยู่ในไฟล์ที่ขึ้นต้นด้วย `"use server"`
> ซึ่ง Next.js ไม่อนุญาต (`A "use server" file can only export async functions,
> found object.`) — **`tsc --noEmit`, `eslint` และ `next build` ผ่านหมด** และหน้าเว็บ
> ก็เรนเดอร์ปกติ แต่พอกดปุ่มจริงทีไรได้ 500 ทุกครั้ง ตอนนี้ย้ายไปไว้ที่
> `app/(customer)/t/[tableCode]/form-state.ts` แล้ว และบันทึกเป็นกฎในหัวข้อ 4 ของ `CLAUDE.md`
>
> บทเรียนสำหรับบทถัดไป: **build ผ่านไม่ได้แปลว่าแอปทำงาน ต้องกดจริงทุกครั้ง**

---

## 4. สิ่งที่ยังค้าง / ข้อจำกัดที่รู้ตัว

- **`git` ยังไม่เคย commit เลยแม้แต่ครั้งเดียว** — มีไฟล์ staged ค้างอยู่ ~246 ไฟล์ตั้งแต่
  session ก่อน ควร commit เป็นก้อน ๆ ก่อนทำบทถัดไป
- หน้า `/t/[tableCode]/orders` อัปเดตด้วยการโหลดหน้าใหม่เท่านั้น (realtime = บทที่ 8)
- `next.config.ts` เปิด `images.remotePatterns` เป็น `hostname: "**"` ไว้ก่อน
  **ต้องแคบให้เหลือเฉพาะ host ของร้านก่อน deploy (บทที่ 16)**
- ยังไม่มีทางให้ลูกค้า/พนักงานปิดรอบโต๊ะ (ต้องรอหน้า POS บทที่ 9)
- ยังไม่มี rate limit ของ Server Action ฝั่งลูกค้า (บทที่ 13 ค่อยทำพร้อม PIN/RBAC)
- ยังไม่มีการเขียน `AuditLog` ตอนสั่ง/ยกเลิก (บทที่ 13)

---

## 5. ขั้นถัดไป — บทที่ 8: จอครัว (KDS) แบบ realtime

1. **Route Handler สำหรับ SSE** เช่น `app/(kds)/kds/stream/route.ts` — ต้องเป็น SSE เท่านั้น
   ห้าม WebSocket ตรง ๆ (Route Handler อัปเกรด connection ไม่ได้ + Vercel ถือ TCP ค้างไม่ได้)
2. **แยกงานตามสถานี** ด้วย `OrderItem.stationId` ที่ snapshot ไว้ตอนสั่งแล้ว — ไม่ต้อง join
   เมนูสด (ร้านเปลี่ยนสถานีของเมนูทีหลังแล้วใบสั่งเก่าต้องไม่ย้ายจอ)
3. **เปลี่ยนสถานะรายรายการ** (`OrderItemStatus`) ผ่าน Server Action โดยเช็คกับตาราง
   transition ใน `lib/order-status.ts` และอัปเดตสถานะบิลเป็นผลรวมของรายการ
4. **วางแผน pub/sub กลางตั้งแต่ต้น** — หลาย instance ไม่แชร์ memory กัน ทางที่เข้ากับ
   stack นี้คือ Postgres `LISTEN/NOTIFY`
5. **กลับมาต่อหน้า `/t/[tableCode]/orders`** ให้รับ event เดียวกัน ลูกค้าจะได้เห็นสถานะขยับเอง

### คำสั่งที่ใช้บ่อยตอนทำงานต่อ

```bash
npm run db:up                    # สตาร์ท Postgres 17 (docker compose)
npm run dev                      # dev server ที่ http://localhost:3000
npm run dev:session a1x7qk       # เปิดรอบโต๊ะ A1 แล้วได้ token ไปใส่ cookie ทดสอบ
npm run dev:reset-table a1x7qk   # ล้างโต๊ะ A1 ให้กลับไปว่าง ก่อนเริ่มทดสอบรอบใหม่
npm run smoke:order              # ทดสอบตรรกะตะกร้ากับ DB จริง (ลบข้อมูลทิ้งให้เอง)
npm run typecheck && npm run lint && npm run build
```

หมายเหตุ: สคริปต์ใน `scripts/` ต้องรันด้วย `tsx --conditions=react-server` เสมอ
(ตั้งไว้ใน `package.json` ให้แล้ว) เพราะ `lib/server/*` มี `import "server-only"`
ซึ่งจะ throw ถ้ารันนอก React Server Components — flag นี้ทำให้มัน resolve ไปที่โมดูลเปล่า
