# SecureShare

Zero-knowledge, end-to-end encrypted platform for sharing PDFs, images, videos, audio, and encrypted messages via secure one-time links.

## Security Architecture

- **Zero-knowledge messages**: Client-side AES-256-GCM encryption with split key fragments (OTP-derived, server-held, URL hash). Server never decrypts.
- **File encryption**: All processed content encrypted at rest with AES-256-GCM (HKDF-derived keys).
- **Forensic watermarks**: DCT (images/PDF pages), LSB (images), phase coding (audio), FFmpeg drawtext (video).
- **Access control**: bcrypt-hashed tokens, SHA3-hashed emails, OTP verification, view limits, expiry, revocation.
- **Secure viewing**: Canvas-only rendering, anti-capture, DevTools detection, focus blur, no downloads.
- **Audit trail**: Append-only audit log with geolocation, device fingerprint, IP.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, HLS.js |
| Backend | Node.js, Express, TypeScript |
| Database | Supabase (PostgreSQL) |
| Storage | Supabase private bucket |
| Cache / Rate limits | In-memory (optional Redis) |
| Virus scanning | Optional ClamAV (via `clamscan` npm package) |
| Email | Resend |
| Processing | FFmpeg, pdf.js, @napi-rs/canvas, sharp, pdf-lib |

## Project Structure

```
secureshare/
├── frontend/          # Next.js 14 App Router
├── backend/           # Express API + processors
├── extractor/         # CLI watermark extraction tool
└── supabase/          # Database schema SQL
```

## Setup

### 1. Clone and configure

```bash
cd secureshare
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Fill in environment variables:

**Backend (`backend/.env`)**
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (random 32+ char strings)
- `ENCRYPTION_KEY`, `WATERMARK_SECRET` (random 32+ char strings)
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `ADMIN_SECRET`

**Frontend (`frontend/.env.local`)**
- `NEXT_PUBLIC_API_URL=http://localhost:3001`
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`

### 2. Supabase

1. Create a Supabase project
2. Run `supabase/schema.sql` in the SQL editor
3. Create a private storage bucket named `secureshare-files` (no public access)

For databases created from an older schema, also run the additions at the bottom of `schema.sql`: the `increment_view_count` / `increment_otp_attempts` functions and `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;`.

### 3. Run backend

```bash
cd backend
npm install
npm run dev
```

PDFs are rendered server-side with `pdfjs-dist` + `@napi-rs/canvas` (no GraphicsMagick, ImageMagick, or Puppeteer). Images use `sharp`. Video/audio use FFmpeg via `ffmpeg-static`.

No external services are required: rate limiting and the geo cache use an in-memory store, and virus scanning is skipped unless configured. To enable the optional services, set in `backend/.env`:

- `REDIS_URL` — point at a Redis server to use it for rate limits and geo caching (recommended in production / multi-instance deployments)
- `CLAMAV_HOST` / `CLAMAV_PORT` — point at a running ClamAV daemon to enable virus scanning of uploads

### 4. Run frontend

```bash
cd frontend
npm install
npm run dev
```

## API Documentation

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Register user, returns JWT + TOTP setup URI |
| POST | `/api/auth/totp/confirm` | JWT | Verify a TOTP code to enable 2FA for the account |
| POST | `/api/auth/login` | — | Login with email/password (+TOTP once enabled) |
| POST | `/api/auth/refresh` | — | Refresh access token |

### Upload (JWT required)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/upload/document` | multipart: file + options | PDF → watermarked pages |
| POST | `/api/upload/image` | multipart | Image with DCT + LSB watermark |
| POST | `/api/upload/video` | multipart | Video → HLS segments |
| POST | `/api/upload/audio` | multipart | Audio → encrypted chunks |
| POST | `/api/upload/message` | JSON: ciphertext, keyFragmentB, etc. | Zero-knowledge message |

### OTP

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/otp/send` | Send 6-digit OTP to recipient email |
| POST | `/api/otp/verify` | Verify OTP, returns view session JWT |

### View (X-View-Session header required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/view/:token/public-info` | Pre-auth share metadata |
| GET | `/api/view/:token/info` | Full metadata after OTP |
| GET | `/api/view/:token/document/:pageIndex` | Decrypted PNG page |
| GET | `/api/view/:token/image` | Decrypted image |
| GET | `/api/view/:token/video/playlist` | HLS playlist |
| GET | `/api/view/:token/video/segment/:index` | Encrypted segment |
| GET | `/api/view/:token/audio/chunk/:index` | Audio chunk |
| GET | `/api/view/:token/message` | Ciphertext + keyFragmentB |
| POST | `/api/view/:token/message/destroy` | Self-destruct message |

### Dashboard (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard/shares` | List user's shares |
| GET | `/api/dashboard/shares/:id/audit` | Audit log for share |
| POST | `/api/dashboard/shares/:id/revoke` | Revoke share |
| DELETE | `/api/dashboard/shares/:id` | Delete share + files |
| GET | `/api/dashboard/stats` | Dashboard statistics |

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/extract` | X-Admin-Secret or user JWT | Extract watermark from image (JWT callers only see watermarks from their own shares) |

## Watermark Extraction

### Dashboard Leak Investigator

Upload a suspected leaked screenshot/image in the dashboard. The request is authenticated with the logged-in user's JWT, and results are restricted to that user's own shares.

### CLI

```bash
cd backend
WATERMARK_SECRET=your-secret npx ts-node ../extractor/extractWatermark.ts ./leaked.png
```

Extracts LSB and DCT watermarks, decrypts payload containing recipient ID, document ID, session ID, timestamp, and email hash.

## Deployment

### Frontend — Vercel

1. Import `frontend/` directory
2. Set env vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`, `ADMIN_SECRET`
3. Deploy

### Backend — Railway

1. Deploy `backend/` as a Node service (`npm install && npm run build`, start with `npm start`)
2. Optionally add the Redis plugin and set `REDIS_URL` (recommended in production)
3. Optionally run ClamAV as a separate service and set `CLAMAV_HOST`/`CLAMAV_PORT`
4. Set all backend env vars; set `FRONTEND_URL` to Vercel domain
5. Minimum 2GB RAM recommended for video processing

### CORS

Ensure `FRONTEND_URL` on backend matches your Vercel deployment URL exactly.

## License

Proprietary — SecureShare platform.
