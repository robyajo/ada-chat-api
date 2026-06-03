import "dotenv/config";
import * as bcrypt from 'bcrypt';
import { PrismaClient, UserRole } from "generated/prisma/client";
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function generatePin(existing: Set<string>): string {
  let pin: string;
  do { pin = String(Math.floor(100000 + Math.random() * 900000)) } while (existing.has(pin))
  existing.add(pin);
  return pin;
}

async function main() {
  console.log('🌱 Starting database seed...');
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash('password123', saltRounds);
  const usedPins = new Set<string>();

  console.log('🧹 Cleaning up database...');
  await prisma.loginLog.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.post.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();

  console.log('👥 Seeding admin user...');
  const admin = await prisma.user.create({
    data: {
      username: 'roby',
      email: 'roby@mituni.id',
      displayName: 'Admin Super',
      passwordHash: hashedPassword,
      pin: generatePin(usedPins),
      isActive: true,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      role: UserRole.ADMIN,
      profile: {
        create: { bio: 'System Administrator and Senior Backend Architect.', website: 'https://vynix.com' },
      },
    },
  });

  console.log('⚙️ Seeding app config...');
  await prisma.appConfig.createMany({
    data: [
      { key: 'patuih_system_api_key', value: 'pt_live_197368c09c5c482219ed6b60e3935bd066c8684c7e170c4d', description: 'Patuih System API Key — digunakan aplikasi untuk publish event' },
      { key: 'patuih_system_tenant_id', value: 'cmpxddhhl00fwv0dglc8uw6jx', description: 'Patuih System Tenant ID' },
      { key: 'app_name', value: 'Ada Chat', description: 'Nama aplikasi' },
      { key: 'app_version', value: '1.0.0', description: 'Versi aplikasi' },
      { key: 'max_upload_size_mb', value: '100', description: 'Batas maksimal upload file (MB)' },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Seeding completed successfully!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
