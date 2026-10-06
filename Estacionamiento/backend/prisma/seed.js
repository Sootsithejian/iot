import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

await prisma.piso.createMany({
  data: [1, 2].map((id) => ({ id })),
  skipDuplicates: true,
});
console.log('2 pisos listos');
await prisma.$disconnect();