import "dotenv/config";
import { prisma } from "@/lib/server/db";
async function main() {
  const now = new Date();
  console.log("now =", now.toISOString());
  const ss = await prisma.tableSession.findMany({
    where: { status: "OPEN" },
    include: { table: { select: { name: true } }, orders: { select: { orderNumber: true, status: true } } },
  });
  for (const s of ss) {
    console.log(`${s.table.name} expiresAt=${s.expiresAt.toISOString()} ยังไม่หมดอายุ=${s.expiresAt > now}`,
      s.orders.map((o) => `${o.orderNumber}:${o.status}`).join(" "));
  }
}
main().then(() => prisma.$disconnect());
