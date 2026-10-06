import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

for (let nivel = 1; nivel <= 2; nivel++) {
  for (let numero = 1; numero <= 6; numero++) {
    const id = (nivel - 1) * 6 + numero;
    await prisma.lugar.upsert({
      where: { id },
      update: { nivel, numero },
      create: { id, nivel, numero },
    });
  }
}
console.log('12 lugares listos (2 pisos x 6)');
await prisma.$disconnect();