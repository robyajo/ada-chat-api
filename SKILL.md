# SKILL.md — Backend Patterns (Ada Chat API)

> Pola-pola yang sudah distandarisasi. Update jika ada perubahan.

## Patuih SDK

- **Import:** `import { Patuih } from 'patuih-sdk'` (no types — cast via `createPatuih()` helper)
- **createPatuih(apiKey, baseUrl)** → returns `PatuihInstance` (`{ getCredits(), publish() }`)
- `validateApiKey(apiKey)` → panggil `patuih.getCredits()` → dapat `tenantId`
- `publish(apiKey, channel, event, data)` → panggil `patuih.publish()`
- `connectToGateway(tenantId)` → `SocketIoClient(baseUrl, { query: { tenantId } })` → listen `event`, `disconnect`, `connect_error`

## Chat WebSocket Gateway (`/chat`)

| Event FE → BE | Data | Fungsi |
|---------------|------|--------|
| `join-room` | `{ roomId, username }` | Join room, publish `chat.join` ke Patuih |
| `send-message` | `{ text, id, sender, timestamp }` | Panggil `patuih.publish(roomId, 'chat.message', data)` |
| `typing` | `{ isTyping }` | Panggil `patuih.publish(roomId, 'chat.typing', data)` |
| `leave-room` | — | Publish `chat.leave`, leave the Socket.IO room |

| Event Patuih → FE | Action |
|-------------------|--------|
| `chat.message` | Tambah pesan ke daftar |
| `chat.join` | Tambah user ke online list + sistem message |
| `chat.leave` | Hapus user dari online list + sistem message |
| `chat.typing` | Tampilkan/sembunyikan typing indicator |
| `chat.present` | Konfirmasi kehadiran user |

## REST Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/chat/patuih-key` | JWT | Save/validate Patuih API Key |
| GET | `/api/v1/chat/patuih-key` | JWT | Cek status API Key |
| DELETE | `/api/v1/chat/patuih-key` | JWT | Hapus API Key |
| POST | `/api/v1/chat/publish` | JWT | Publish message via REST (fallback) |

## Prisma

- **Provider:** PostgreSQL via `@prisma/adapter-pg`
- **Generate:** `npx prisma generate`
- **Schema folder:** `prisma/models/*.prisma` (modular)
- **Client output:** `generated/prisma/`
- **Field naming:** camelCase
- Setiap tambah field di model → regenerate client → `npx nest build` untuk verifikasi

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
