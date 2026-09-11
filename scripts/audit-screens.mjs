/**
 * วัดหน้าจอจริงผ่าน Chrome DevTools Protocol (ไม่ต้องลง puppeteer)
 *
 *     npm run build && npm run start -- -p 3002       # ต้องวัดกับ build จริง
 *     AUDIT_COOKIES='[{"name":"pos_staff_session","value":"<token>","domain":"localhost","path":"/"}]' \
 *     AUDIT_PAGES='[{"path":"/pos","mustSee":["ซื้อกลับ"],"openDetails":true}]' \
 *     npm run audit:screens
 *
 * token ออกด้วย `npm run dev:staff-cookie <รหัสพนักงาน>` · AUDIT_ORIGIN เปลี่ยนพอร์ตได้
 *
 * ⚠ ต้องเตรียมข้อมูลให้หน้าที่จะวัด "มีของอยู่จริง" ก่อนเสมอ — หน้าโต๊ะที่ไม่มีรอบเปิด
 * จะแสดงฟอร์มเปิดโต๊ะแทน แล้วสคริปต์จะรายงานว่าหาข้อความที่สั่งให้หาไม่เจอ
 * ซึ่งเป็นคนละเรื่องกับจอพัง
 *
 * วัดสามอย่าง — ข้อ 2 กับ 3 คือของที่สคริปต์รุ่นก่อนไม่ได้วัด แล้วปล่อยบั๊กผ่าน:
 *   1. ล้นแนวนอน  documentElement.scrollWidth > innerWidth
 *   2. ล้นแนวตั้ง  documentElement.scrollHeight > innerHeight
 *      (เชลล์เป็น h-dvh overflow-hidden — ถ้าทั้งหน้าเลื่อนได้แปลว่ามีของทะลุออกมา
 *       เช่นเคส sr-only ที่ position:absolute แล้วไปดันความสูงของ document)
 *   3. ของที่ "ต้องเห็น" ถูกกล่องแม่ที่เลื่อนได้ตัดทิ้งหรือเปล่า — เทียบกับกรอบของ
 *      กล่องที่เลื่อนได้จริง ไม่ใช่เทียบกับ viewport (เคส "รวมทั้งสิ้นหายจากจอ")
 *   4. โซน overflow-auto ที่ถูก flexbox บีบจนแบน (สูงน้อยกว่า 96px ทั้งที่เนื้อในยาวกว่าเท่าตัว)
 *   5. ของใน <header>/<nav> ที่ยื่นออกนอกกล่องแม่ — เชลล์เป็น `overflow-hidden` แถบหัวจอ
 *      ที่ล้นจึงถูกตัดทิ้งเงียบ ๆ โดย document ไม่กว้างขึ้นเลย (ข้อ 1 มองไม่เห็น) และแถบที่
 *      `justify-end` จะล้นไป "ทางซ้าย" ทับชื่อจอ ซึ่งไม่หลุดขอบจอด้วยซ้ำ
 *      (เจอจริงตอนเพิ่มปุ่มสลับภาษาบนแถบจอครัว: 390px ล้น 74px ทั้งที่ข้อ 1-4 ผ่านหมด)
 *      · ภาษาเวียดนามยาวกว่าอังกฤษ **ต้องวัดทั้งสองภาษา** ใส่ `pos_locale` ใน AUDIT_COOKIES
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const ORIGIN = process.env.AUDIT_ORIGIN ?? "http://localhost:3002";

/** `AUDIT_VIEWPORTS='[{"name":"280","width":280,"height":800}]'` ใช้ลองว่าตัววัดจับของพังได้จริง */
const VIEWPORTS = process.env.AUDIT_VIEWPORTS
  ? JSON.parse(process.env.AUDIT_VIEWPORTS)
  : [
      { name: "390x844", width: 390, height: 844 },
      { name: "768x1024", width: 768, height: 1024 },
      { name: "1024x768", width: 1024, height: 768 },
      { name: "1280x700", width: 1280, height: 700 },
      { name: "1440x900", width: 1440, height: 900 },
    ];

const pages = JSON.parse(process.env.AUDIT_PAGES ?? "[]");
const cookies = JSON.parse(process.env.AUDIT_COOKIES ?? "[]");

const userDataDir = mkdtempSync(join(tmpdir(), "audit-chrome-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--disable-gpu",
  "about:blank",
]);

async function waitForDevTools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("chrome devtools ไม่ตอบ");
}

await waitForDevTools();

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const loadWaiters = [];

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) {
      reject(new Error(JSON.stringify(msg.error)));
    } else {
      resolve(msg.result);
    }
  }
  if (msg.method === "Page.loadEventFired") {
    while (loadWaiters.length) loadWaiters.shift()();
  }
});

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");

for (const cookie of cookies) {
  await send("Network.setCookie", { ...cookie, url: ORIGIN });
}

const AUDIT_FN = `(mustSee) => {
  const doc = document.documentElement;
  const horizontal = doc.scrollWidth - window.innerWidth;
  const vertical = doc.scrollHeight - window.innerHeight;

  const scrollable = [...document.querySelectorAll("*")].filter((el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
  });

  const squeezed = scrollable
    .filter((el) => el.clientHeight < 96 && el.scrollHeight > el.clientHeight * 2)
    .map((el) => ({
      tag: el.tagName.toLowerCase() + "." + [...el.classList].slice(0, 2).join("."),
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));

  function scrollAncestor(el) {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(style.overflowY) || /(auto|scroll|hidden)/.test(style.overflowX)) {
        return p;
      }
    }
    return null;
  }

  const missing = [];
  for (const text of mustSee) {
    /**
     * หา element ที่ "ลึกที่สุดที่ยังมีข้อความนี้ครบ" ไม่ใช่ element ที่ไม่มีลูก
     *
     * เดิมกรองด้วย \`children.length === 0\` ซึ่งพลาดสองทาง:
     *   - ข้อความที่มี <strong> คั่นกลาง จะไม่มีใบไหนถือครบทั้งประโยค
     *   - <script> ของ RSC payload **เป็นใบและมีข้อความนั้นอยู่** สคริปต์จึงไป
     *     วัดแท็ก script แล้วรายงานว่า "ถูกซ่อนทุกตัว" ทั้งที่ของจริงอยู่บนจอ
     */
    const nodes = [...document.querySelectorAll("body *")].filter((el) => {
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) return false;
      if (!el.textContent.includes(text)) return false;
      return ![...el.children].some((child) => child.textContent.includes(text));
    });

    if (nodes.length === 0) {
      missing.push({ text, why: "ไม่มีบนหน้านี้เลย" });
      continue;
    }

    /**
     * ข้อความเดียวกันโผล่ได้หลายที่ (แถบเมนูของจอกว้าง + หัวหน้าจอ + แถบล่างของจอแคบ)
     * และหลายตัวถูกซ่อนตามขนาดจอโดยตั้งใจ — ต้องถามว่า "มองเห็นได้ที่ไหนสักที่ไหม"
     * ไม่ใช่ "ตัวแรกใน DOM มองเห็นไหม" ซึ่งรายงานผิดทุกครั้งที่ตัวแรกคือของที่ถูกซ่อน
     */
    const el = nodes.find((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });

    if (!el) {
      missing.push({ text, why: "มีในหน้าแต่ถูกซ่อนทุกตัว (กว้าง/สูงเป็น 0)" });
      continue;
    }

    const rect = el.getBoundingClientRect();
    const box = scrollAncestor(el);
    if (box) {
      const bound = box.getBoundingClientRect();
      const clipped =
        rect.bottom <= bound.top + 1 ||
        rect.top >= bound.bottom - 1 ||
        rect.right <= bound.left + 1 ||
        rect.left >= bound.right - 1;
      const reachable = box.scrollHeight >= rect.height;
      if (clipped && !reachable) {
        missing.push({ text, why: "ถูกกล่องที่เลื่อนได้ตัดทิ้งและเลื่อนไปหาไม่ได้" });
        continue;
      }
      if (box.clientHeight < rect.height) {
        missing.push({ text, why: "กล่องแม่เตี้ยกว่าตัวมันเอง (" + box.clientHeight + "px < " + Math.round(rect.height) + "px)" });
      }
    }
  }

  // ข้อ 5 — ลูกที่ยื่นออกนอกกล่องแม่ในแถบหัวจอ/แถบเมนู (ข้ามแถบที่ตั้งใจให้เลื่อนแนวนอน)
  const insideScroller = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
    }
    return false;
  };
  const barEscapes = [];
  for (const bar of document.querySelectorAll("header, nav")) {
    for (const parent of [bar, ...bar.querySelectorAll("*")]) {
      if (insideScroller(parent)) continue;
      const pr = parent.getBoundingClientRect();
      if (pr.width === 0) continue;
      for (const child of parent.children) {
        const cs = getComputedStyle(child);
        if (cs.position === "absolute" || cs.position === "fixed") continue;
        const cr = child.getBoundingClientRect();
        if (cr.width === 0 || cr.height === 0) continue;
        const by = Math.max(pr.left - cr.left, cr.right - pr.right);
        if (by > 1) {
          barEscapes.push({ text: child.textContent.trim().replace(/\\s+/g, " ").slice(0, 30), by: Math.round(by) });
        }
      }
    }
  }

  return { horizontal, vertical, squeezed, missing, barEscapes, title: document.title };
}`;

const results = [];

for (const target of pages) {
  for (const viewport of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 700,
    });

    const loaded = new Promise((resolve) => loadWaiters.push(resolve));
    await send("Page.navigate", { url: ORIGIN + target.path });
    await loaded;
    await new Promise((r) => setTimeout(r, 350));

    /**
     * `openDetails: true` = กาง <details> ทุกใบก่อนวัด
     *
     * ของที่พับอยู่ไม่มีความสูง สคริปต์จึงบอกว่า "ไม่ล้น" ได้เสมอ ทั้งที่ตอนคนกดกาง
     * จริงอาจดันจอพัง — แผงย้าย/รวมโต๊ะกับปุ่มปิดรอบโต๊ะเป็นแบบนั้นทั้งคู่
     */
    if (target.openDetails) {
      await send("Runtime.evaluate", {
        expression: `document.querySelectorAll("details").forEach((d) => { d.open = true; })`,
      });
      await new Promise((r) => setTimeout(r, 200));
    }

    const href = await send("Runtime.evaluate", { expression: "location.pathname + location.search", returnByValue: true });
    const evaluated = await send("Runtime.callFunctionOn", {
      functionDeclaration: AUDIT_FN,
      executionContextId: undefined,
      objectId: (await send("Runtime.evaluate", { expression: "document", returnByValue: false })).result.objectId,
      arguments: [{ value: target.mustSee ?? [] }],
      returnByValue: true,
    });

    results.push({
      path: target.path,
      actual: href.result.value,
      viewport: viewport.name,
      scrolls: target.scrolls === true,
      ...evaluated.result.value,
    });
  }
}

let failed = 0;
for (const r of results) {
  const problems = [];
  if (r.actual !== r.path.split("#")[0]) problems.push(`ไปโผล่ที่ ${r.actual}`);
  if (r.horizontal > 0) problems.push(`ล้นแนวนอน ${r.horizontal}px`);
  /**
   * `scrolls: true` = หน้านี้ตั้งใจให้ทั้งหน้าเลื่อนได้ (หน้าจอลูกค้าไม่ได้อยู่ในเชลล์
   * `h-dvh overflow-hidden` ของจอพนักงาน) — วัดแนวตั้งกับมันจะได้ FAIL ทุกครั้ง
   * ที่เมนูยาวเกินจอ ซึ่งไม่ใช่บั๊ก · ห้ามใส่ให้หน้าในเชลล์เด็ดขาด เพราะที่นั่น
   * "ทั้งหน้าเลื่อนได้" คือสัญญาณของบั๊กจริง (เคส sr-only ในโมดูล 04)
   */
  if (!r.scrolls && r.vertical > 0) problems.push(`ล้นแนวตั้ง ${r.vertical}px`);
  for (const s of r.squeezed) problems.push(`โซนเลื่อนถูกบีบ ${s.tag} ${s.clientHeight}/${s.scrollHeight}px`);
  for (const m of r.missing) problems.push(`"${m.text}" ${m.why}`);
  for (const e of r.barEscapes) problems.push(`แถบหัวจอ/เมนูล้นกล่อง "${e.text}" ${e.by}px`);

  if (problems.length) failed++;
  console.log(
    `${problems.length ? "FAIL" : "PASS"}  ${r.viewport.padEnd(9)} ${r.path}${problems.length ? " — " + problems.join(" · ") : ""}`,
  );
}

console.log(`\nรวม ${results.length} เคส — PASS ${results.length - failed} · FAIL ${failed}`);

ws.close();
chrome.kill();
process.exit(failed ? 1 : 0);
