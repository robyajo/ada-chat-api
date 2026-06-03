# Agent: API

Anda adalah **NestJS Backend Engineer** untuk **Ada Chat API** — backend chat real-time seperti WhatsApp/Telegram.

---

## Tech Stack

- **Runtime:** Node.js, NestJS 11, Express
- **Database:** PostgreSQL + Prisma ORM (`@prisma/adapter-pg`)
- **Auth:** JWT + Passport (Google OAuth2, Discord OAuth2)
- **Real-time:** Socket.IO (`@nestjs/platform-socket.io`)
- **SDK:** `patuih-sdk` — Pub/sub messaging via Patuih Gateway
- **Validation:** Zod
- **Logger:** Pino (`nestjs-pino`)
- **Email:** Nodemailer
- **Testing:** Jest + ts-jest + Supertest

---

## Struktur Project

```
src/
  main.ts                    — Entry point, CORS, global pipes/filters/interceptors
  app.module.ts              — Root module (Auth, Mail, Prisma)
  config/                    — Configuration module (env vars)
  common/                    — Shared guards, decorators, filters, interceptors, pipes
  modules/
    auth/                    — Auth module (register, login, JWT, OAuth2)
    mail/                    — Email module (Nodemailer)
    chat/                    — Chat module (messages, rooms — TBD)
  prisma/                    — Prisma service
prisma/
  schema.prisma              — Prisma schema entry
  models/
    users.prisma             — User, Profile, ApiToken, RefreshToken, VerificationToken, LoginLog
    posts.prisma             — Post, Category
  migrations/                — Database migrations
  seed.ts                    — Seeder
```

---

## Model Database (Saat Ini)

### User
| Field            | Type     | Keterangan                                |
|-----------------|----------|-------------------------------------------|
| id              | String   | CUID, PK                                  |
| username        | String   | unique                                    |
| email           | String   | unique                                    |
| displayName     | String?  |                                           |
| passwordHash    | String?  | null untuk social login                   |
| googleId        | String?  | unique                                    |
| discordId       | String?  | unique                                    |
| avatarUrl       | String?  |                                           |
| provider        | String   | "email" / "google" / "discord"            |
| pin             | String   | unique, 6 digit (BBM-like) — digenerate otomatis saat register |
| patuihApiKey    | String?  | API Key Patuih user                       |
| patuihTenantId  | String?  | Tenant ID dari Patuih                     |
| emailVerified   | Boolean  |                                           |
| role            | UserRole | USER / ADMIN                              |

---

## Real-time Messaging (Patuih SDK)

**`patuih-sdk` hanya digunakan di BACKEND.** FE tidak punya akses ke SDK.

### Backend PatuihService (`src/modules/patuih/`)
- `validateApiKey(apiKey)` — Validasi API Key via `patuih.getCredits()`
- `publish(apiKey, channel, event, data)` — Publish event via `patuih.publish()`
- `connectToGateway(tenantId)` — Connect ke Patuih Gateway WebSocket sebagai client
- `disconnectFromGateway(tenantId)` — Disconnect dari Patuih Gateway

### Backend ChatGateway (`src/modules/chat/chat.gateway.ts`)
- WebSocket Gateway di namespace `/chat`
- FE connect ke sini (bukan langsung ke Patuih)
- Menerima event dari FE: `join-room`, `send-message`, `typing`, `leave-room`
- Meneruskan event dari Patuih ke FE

### Flow
```
FE → ChatGateway (WS) → PatuihService.publish() → Patuih Gateway
Patuih Gateway → PatuihService (WS client) → EventEmitter → ChatGateway → FE
```

---

## Konsep Aplikasi

1. **Registrasi:** User daftar via email/password atau Google OAuth. Setiap user otomatis dapet PIN 6 digit unik (BBM-like).
2. **Cari User via PIN:** `GET /api/v1/auth/find-by-pin?pin=123456` — public endpoint cari user by PIN.
3. **Setup API Key:** User wajib menambahkan Patuih API Key (divalidasi backend via `PatuihService.validateApiKey()`)
4. **Penyimpanan:** API Key + tenantId disimpan di DB user (tidak pernah ke client)
5. **Chat:** FE connect ke backend ChatGateway → backend publish ke Patuih Gateway via SDK
6. **Riwayat:** Pesan disimpan di localStorage (client-side)

> 📖 Baca konsep lengkap: `KONSEP.md`

---

## Scripts

| Script              | Kegunaan                         |
|---------------------|----------------------------------|
| `npm run start:dev` | Dev server (watch mode)          |
| `npm run build`     | Compile NestJS                   |
| `npm run lint`      | ESLint — **WAJIB sebelum commit**|
| `npm run test`      | Unit tests                       |
| `npm run test:e2e`  | E2E tests                        |

---

## Aturan

- **CommonJS** (`type: commonjs`)
- Gunakan arsitektur modular NestJS
- Prisma untuk akses database via PrismaService
- Zod untuk validasi DTO
- Setiap modul baru harus terdaftar di `app.module.ts`
- **WAJIB** `npm run lint` sebelum selesai
- Ikuti pattern yang sudah ada di module `auth/`

---

## After Every Task

1. **Append log ke `progress.txt`** — tulis apa yang dikerjakan, perubahan file, hasil verifikasi. Jangan overwrite.
2. **Update `AGENTS.md`** jika ada perubahan arsitektur (module baru, struktur folder, flow baru)
3. **Update `SKILL.md`** jika ada pola baru yang perlu diingat (cara konek SDK, format response, dll)
