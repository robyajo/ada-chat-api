# Ada Chat API — Konsep Backend

Chat interaktif real-time seperti WhatsApp/Telegram. Backend menangani autentikasi, penyimpanan data, dan komunikasi dengan Patuih Gateway.

---

## Arsitektur

```
┌──────────────────────────────────────────────────────────────────┐
│                      Backend (NestJS API)                          │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Auth     │  │ Chat     │  │ Patuih       │  │ Prisma       │ │
│  │ Module   │  │ Module   │  │ Module       │  │ (PostgreSQL) │ │
│  └─────┬────┘  └─────┬────┘  └──────┬───────┘  └──────┬───────┘ │
│        │             │              │                  │         │
│        └── JWT ──────┼──────────────┼──────────────────┘         │
│                      │              │                            │
│              ┌───────▼──────────────▼───────┐                    │
│              │  ChatGateway (/chat WS)       │                    │
│              │  - Menerima koneksi FE        │                    │
│              │  - Forward message → Patuih   │                    │
│              │  - Forward event → FE         │                    │
│              └───────────────────────────────┘                    │
│                                                                   │
│              ┌───────────────────────────────┐                    │
│              │  PatuihService                │                    │
│              │  - validateApiKey()           │                    │
│              │  - publish() → patuih-sdk     │                    │
│              │  - connectToGateway() WS      │                    │
│              └──────────┬────────────────────┘                    │
└─────────────────────────┼──────────────────────────────────────────┘
                          │ WebSocket + REST (patuih-sdk)
                          │ (API Key hanya di backend!)
┌─────────────────────────▼──────────────────────────────────────────┐
│                    Patuih Gateway (Cloud)                           │
│  - WebSocket + HTTP API                                             │
│  - Publish/Subscribe channel-based messaging                        │
│  - Events: chat.message, chat.join, chat.leave, chat.typing        │
└────────────────────────────────────────────────────────────────────┘
```

---

## Alur Registrasi & API Key

1. **User mendaftar** via `POST /api/v1/auth/register` (email/password) atau **Google OAuth**
2. **Setelah login**, user wajib mengisi **Patuih API Key** via `POST /api/v1/chat/patuih-key`
3. Backend memvalidasi API Key via `PatuihService.validateApiKey()`:
   - Panggil `patuih.getCredits()` → dapat `tenantId`
4. `patuihApiKey` + `patuihTenantId` disimpan ke **database User**
5. Tanpa API Key, user **tidak bisa** membuat/join room chat

## Alur Chat (Side Pandangan Backend)

```
FE ChatGateway (WS) → receive "send-message"
    → PatuihService.publish(apiKey, roomId, "chat.message", data)
    → Patuih Gateway broadcast ke semua subscriber

Patuih Gateway → PatuihService (WS client) receive "event"
    → EventEmitter emit("patuih.event.<channel>", payload)
    → ChatGateway forward ke FE via WebSocket
```

### Events yang ditangani backend:

| Event Patuih | Action Backend |
|-------------|----------------|
| `chat.message` | Forward ke FE |
| `chat.join` | Forward ke FE |
| `chat.leave` | Forward ke FE |
| `chat.typing` | Forward ke FE |
| `chat.present` | Forward ke FE |

---

## Model Database

### User (di `prisma/models/users.prisma`)

| Field            | Type     | Keterangan                             |
|-----------------|----------|----------------------------------------|
| id              | String   | CUID, PK                               |
| username        | String   | unique                                 |
| email           | String   | unique                                 |
| displayName     | String?  |                                        |
| passwordHash    | String?  | null untuk social login                |
| googleId        | String?  | unique                                 |
| discordId       | String?  | unique                                 |
| avatarUrl       | String?  |                                        |
| provider        | String   | "email" / "google" / "discord"         |
| patuihApiKey    | String?  | API Key Patuih (disimpan aman di DB)   |
| patuihTenantId  | String?  | Tenant ID dari hasil verifikasi        |
| emailVerified   | Boolean  |                                        |
| role            | UserRole | USER / ADMIN                           |

### Messages (opsional — jika ingin persist server-side)

| Field       | Type     | Keterangan                     |
|-------------|----------|--------------------------------|
| id          | String   | Primary key (cuid)             |
| roomId      | String   | ID room                        |
| senderId    | String   | FK ke User                     |
| text        | String   | Isi pesan                      |
| timestamp   | DateTime | Waktu kirim                    |

---

## REST Endpoints

| Method | Endpoint                    | Auth  | Deskripsi                          |
|--------|-----------------------------|-------|------------------------------------|
| POST   | `/api/v1/auth/register`     | Public| Register email/password            |
| POST   | `/api/v1/auth/login`        | Public| Login                              |
| POST   | `/api/v1/auth/refresh`      | Public| Refresh token                      |
| GET    | `/api/v1/auth/google`       | Public| Google OAuth redirect              |
| GET    | `/api/v1/auth/me`           | JWT   | Get profile                        |
| POST   | `/api/v1/chat/patuih-key`   | JWT   | Simpan/update API Key Patuih       |
| GET    | `/api/v1/chat/patuih-key`   | JWT   | Cek status API Key                 |
| DELETE | `/api/v1/chat/patuih-key`   | JWT   | Hapus API Key                      |
| POST   | `/api/v1/chat/publish`      | JWT   | Publish message (REST fallback)    |

---

## WebSocket Gateway (`/chat`)

### Dari FE ke Backend

| Event        | Data                                       | Keterangan            |
|--------------|--------------------------------------------|-----------------------|
| `join-room`  | `{ roomId, username }`                     | Join room             |
| `send-message`| `{ text, id, sender, timestamp }`        | Kirim pesan           |
| `typing`     | `{ isTyping }`                             | Status mengetik       |
| `leave-room` | —                                          | Tinggalkan room       |

### Dari Backend ke FE

| Event   | Data                                                     |
|---------|----------------------------------------------------------|
| `event` | `{ channel, event, data, timestamp }` — sama seperti dari Patuih |

---

## Tech Stack

- **Runtime:** Node.js + NestJS 11 + Express
- **Database:** PostgreSQL + Prisma ORM (`@prisma/adapter-pg`)
- **Auth:** JWT + Passport (Google OAuth2, Discord OAuth2)
- **WebSocket:** `@nestjs/platform-socket.io` (server) + `socket.io-client` (client ke Patuih)
- **SDK:** `patuih-sdk` — `getCredits()` + `publish()`
- **Validation:** Zod
- **Logger:** Pino (`nestjs-pino`)
- **Email:** Nodemailer
- **Testing:** Jest + ts-jest + Supertest

---

## Keamanan

- API Key Patuih **hanya di server** (database), tidak pernah ke client
- Frontend hanya pegang **JWT token** + **tenantId** (tenantId tidak sensitif)
- JWT Access Token (15 menit) + Refresh Token (7 hari) + auto-rotate
- Validasi API Key dilakukan server-side via `patuih.getCredits()`
