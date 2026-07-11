import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Check if admin already exists
  const existing = await prisma.user.findUnique({ where: { email: 'admin@local.dev' }});
  if (existing) {
    console.log('Admin already exists.');
    return;
  }

  const team = await prisma.team.create({
    data: {
      name: 'Acme Corp',
    },
  });

  const passwordHash = await bcrypt.hash('password123', 10);

  await prisma.user.create({
    data: {
      email: 'admin@local.dev',
      name: 'Admin User',
      passwordHash,
      role: 'ADMIN',
      teamId: team.id,
    },
  });
  
  console.log('Database seeded with admin@local.dev (password: password123)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
