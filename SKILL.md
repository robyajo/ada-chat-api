# SKILL.md — Backend Patterns (Ada Chat API)

> Pola-pola yang sudah distandarisasi. Update jika ada perubahan.

## Patuih SDK

- **Import:** `import { Patuih } from 'patuih-sdk'` (no types — cast via `createPatuih()` helper)
- **createPatuih(apiKey, baseUrl)** → returns `PatuihInstance` (`{ getCredits(), publish() }`)
- `validateApiKey(apiKey)` → panggil `patuih.getCredits()` → dapat `tenantId`
- `publish(apiKey, channel, event, data)` → panggil `patuih.publish()`
- `connectToGateway(tenantId)` → `SocketIoClient(baseUrl, { query: { tenantId } })` → listen `event`, `disconnect`, `connect_error`

## Redis (ioredis)

- **Module:** `src/modules/redis/` (global, auto-inject)
- **Config:** `REDIS_URL` env var (default `redis://localhost:6379`)
- **Key patterns:**
  - `online:users` (set) — semua user online
  - `online:{userId}` — flag user online (TTL 5 menit)
  - `socket:{userId}` → socketId
  - `sockmap:{userId}` → socketId (persisten)
  - `sockuser:{socketId}` → userId
  - `lastseen:{userId}` → timestamp (TTL 24 jam)
  - `typing:{roomId}:{userId}` → username (TTL 10 detik)
  - `typing_room:{roomId}` (set) — user yg sedang typing
  - `ratelimit:{key}` → count (TTL variabel)

## Chat WebSocket Gateway (`/chat`)

### Event FE → BE

| Event | Data | Fungsi |
|-------|------|--------|
| `join-room` | `{ roomId, username }` | Join room, publish `chat.join` ke Patuih |
| `send-message` | `{ text, id, sender, timestamp, type?, replyToId? }` | Panggil `publishMessage()` → save DB + Patuih |
| `typing` | `{ isTyping }` | Update Redis typing set + publish `chat.typing` |
| `leave-room` | — | Publish `chat.leave`, cleanup listener |
| `message-delivered` | `{ msgId }` | Update `MessageStatus` ke `delivered`, notify room |
| `message-read` | `{ msgId }` | Update `MessageStatus` ke `read`, notify room |
| `message-edit` | `{ msgId, text }` | Update message text, set `editedAt`, publish `chat.edited` |
| `message-delete` | `{ msgId, mode? }` | Soft/hard delete, publish `chat.deleted` |
| `message-reaction` | `{ msgId, emoji }` | Toggle reaction, publish `chat.reaction` |

### Event Patuih/Server → FE

| Event | Action |
|-------|--------|
| `chat.message` | Tambah pesan ke daftar |
| `chat.join` | Tambah user ke online list + system message |
| `chat.leave` | Hapus user dari online list + system message |
| `chat.typing` | Tampilkan/sembunyikan typing indicator |
| `chat.present` | Konfirmasi kehadiran user |
| `chat.edited` | Update teks pesan di client |
| `chat.deleted` | Tandai pesan sebagai terhapus |
| `chat.reaction` | Tambah/hapus reaksi di pesan |
| `message.delivered` | Update status jadi delivered |
| `message.read` | Update status jadi read |

## REST Endpoints (Chat)

### Messages
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/chat/publish` | JWT | Kirim pesan (REST fallback) |
| GET | `/api/v1/chat/messages/:roomId` | JWT | Riwayat pesan (include replies, attachments, reactions, statuses) |
| PATCH | `/api/v1/chat/messages/:msgId` | JWT | Edit pesan (hanya sender) |
| DELETE | `/api/v1/chat/messages/:msgId?mode=soft` | JWT | Hapus pesan (sender/owner) |
| POST | `/api/v1/chat/messages/:msgId/reactions` | JWT | Toggle reaksi emoji |
| POST | `/api/v1/chat/messages/read` | JWT | Tandai baca 1 pesan |
| GET | `/api/v1/chat/messages/:msgId/status` | JWT | Statistik status pesan |

### Attachments
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/chat/upload` | JWT | Upload file (max 50MB) |
| GET | `/api/v1/chat/attachments/:roomId` | JWT | Daftar file di room (filter `?type=image|audio|video`) |

### Read Receipts
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/chat/rooms/:roomId/read` | JWT | Tandai semua pesan room sudah dibaca |

### Settings
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/chat/settings` | JWT | Dapatkan user settings |
| PATCH | `/api/v1/chat/settings` | JWT | Update settings (theme, language, notif, dll) |

### Recent & Last Room
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/chat/recent` | JWT | 20 percakapan terakhir |
| GET | `/api/v1/chat/last-room` | JWT | Room terakhir yang dikunjungi |
| POST | `/api/v1/chat/last-room` | JWT | Simpan room terakhir |

## Prisma

- **Provider:** PostgreSQL via `@prisma/adapter-pg`
- **Generate:** `npx prisma generate`
- **Schema folder:** `prisma/models/*.prisma` (modular)
- **Client output:** `generated/prisma/`
- **Field naming:** camelCase
- Setiap tambah field di model → regenerate client → `npx nest build` untuk verifikasi

### Model Baru (chat features)
- `Message` — extended dengan `replyToId`, `editedAt`, `deletedAt`, relasi ke `MessageStatus`, `MessageReaction`, `Attachment`
- `MessageStatus` — track sent/delivered/read per user
- `MessageReaction` — emoji reactions
- `Attachment` — file uploads (image, audio, video, document)
- `UserSetting` — preferensi user perangkat
- `RecentConversation` — cache percakapan terbaru
- `UserLastRoom` — room terakhir user

## Storage Flow

| Data | Storage | Keterangan |
|------|---------|------------|
| Messages | PostgreSQL | Pesan permanen |
| MessageStatus | PostgreSQL | Delivery/read receipts |
| Attachments | Disk (`./uploads/chat/`) + DB path | File fisik + metadata |
| Online Users | Redis (TTL 5m) | Cepat, volatile |
| Typing | Redis (TTL 10s) | Volatile, real-time |
| Socket Mapping | Redis | Map userId ↔ socketId |
| Last Seen | Redis (TTL 24h) | Waktu terakhir online |
| Rate Limiter | Redis | Anti-spam |
| Pub/Sub | Redis `pub/sub` | Skalabilitas multi-instance |
| Session Tokens | Browser localStorage | JWT access + refresh |
| UI State | Browser localStorage | Draft, recent DMs, theme |
| Chat Messages Cache | Browser localStorage | Riwayat pesan offline |

## Error Handling

- `NotFoundException` — resource tidak ditemukan
- `BadRequestException` — validasi gagal
- `UnauthorizedException` — auth gagal
- `ConflictException` — duplikat data
- Global filter: `HttpExceptionFilter`
- Global interceptor: `ResponseInterceptor`

## Logger

- `private readonly logger = new Logger(NamaService.name)`
- Gunakan Pino via `nestjs-pino`
