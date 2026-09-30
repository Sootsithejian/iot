import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

await prisma.lugar.createMany({
  data: [1, 2, 3, 4, 5, 6].map((id) => ({ id })),
  skipDuplicates: true,
});
console.log('6 lugares listos');
await prisma.$disconnect();