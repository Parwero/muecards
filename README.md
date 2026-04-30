# Muecards

Aplicación interna para programar publicaciones de Instagram de una colección de cartas TCG. Stack 100% gratuito: Next.js 14 (App Router) + Supabase + Vercel Cron + Instagram Graph API.

## Stack

- **Framework:** Next.js 14 (App Router, React 18, TypeScript)
- **UI:** Tailwind CSS + Lucide icons — tema dark "coleccionista" con acento oro (`#e4b062`) y tipografía serif (Cormorant Garamond)
- **DB / Storage:** Supabase (tabla `scheduled_posts` + bucket público `post-images`)
- **Despliegue:** Vercel (hobby tier) con Cron Job horario
- **Publicación:** Instagram Graph API (flujo de 2 pasos: `media` → `media_publish`)

## Estructura

```
muecards/
├── app/
│   ├── layout.tsx                # Shell + fuentes + metadata
│   ├── page.tsx                  # Dashboard (upload · form · cola)
│   ├── globals.css
│   └── api/
│       ├── schedule/route.ts     # POST — sube imagen + guarda row
│       ├── publish/route.ts      # GET (cron) — publica en IG
│       └── posts/route.ts        # GET — lista para el dashboard
├── components/
│   ├── Logo.tsx
│   ├── UploadZone.tsx
│   ├── ScheduleForm.tsx
│   └── ScheduledList.tsx
├── lib/supabase.ts               # Clientes browser / service-role
├── types/index.ts
├── supabase/schema.sql           # Schema + bucket + RLS
├── vercel.json                   # Cron "0 * * * *" → /api/publish
├── .env.local.example
└── tailwind.config.ts
```

## Setup

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Abre el **SQL Editor** y ejecuta `supabase/schema.sql` — crea la tabla, el bucket público `post-images` y habilita RLS.
3. Ve a **Settings → API** y copia:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon / public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ server-only)

### 2. Instagram Graph API

Requiere una cuenta **Business o Creator** vinculada a una **Página de Facebook**.

1. Crea una app en [developers.facebook.com](https://developers.facebook.com/) con el producto **Instagram Graph API**.
2. Desde el Graph API Explorer solicita los permisos:
   `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`.
3. Genera un token corto → intercámbialo por uno **long-lived (60 días)**:
   ```
   GET /oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={app-id}
     &client_secret={app-secret}
     &fb_exchange_token={short-token}
   ```
4. Obtén el `IG_USER_ID` numérico:
   ```
   GET /{page-id}?fields=instagram_business_account&access_token={token}
   ```
5. Guarda ambos en `.env.local`.

> Los tokens long-lived duran 60 días. Programa una renovación periódica o considera el flujo de [System User Tokens](https://developers.facebook.com/docs/marketing-api/system-users/) para tokens que no expiran.

### 3. Variables de entorno

```bash
cp .env.local.example .env.local
```

Rellena todas las claves (ver `.env.local.example` — documentado línea por línea).

### 4. Desarrollo local

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>.

### 5. Despliegue en Vercel

1. `vercel link` & `vercel --prod` (o conecta el repo desde el dashboard).
2. En **Project Settings → Environment Variables**, replica las del `.env.local` en `Production`.
3. Vercel detecta automáticamente `vercel.json` y activa el cron horario `/api/publish`.
4. Cada request del cron llega con `Authorization: Bearer $CRON_SECRET` — la route lo valida.

## Cómo funciona

### Programar (POST /api/schedule)
1. Recibe `multipart/form-data` con `image`, `caption`, `scheduled_time`.
2. Valida formato (JPG/PNG/WEBP, ≤ 8 MB), longitud del caption (≤ 2200) y que la fecha sea futura.
3. Sube la imagen a `post-images/pending/<uuid>.<ext>`.
4. Resuelve la URL pública (IG necesita una URL fetchable).
5. Inserta una fila en `scheduled_posts` con `status='pending'`.
6. Rollback automático del objeto si el insert falla.

### Publicar (GET /api/publish — cron)
1. Autoriza el request contra `CRON_SECRET`.
2. Selecciona posts con `status='pending'` y `scheduled_time <= now()`, ordenados y limitados a 25.
3. Por cada uno, llamada en dos pasos a Graph API:
   - `POST /{ig-user-id}/media` con `image_url` + `caption` → `creation_id`
   - Polling de `status_code` (FINISHED / ERROR / EXPIRED)
   - `POST /{ig-user-id}/media_publish` con `creation_id`
4. En éxito: `status='published'`, guarda `ig_media_id`, borra el objeto del bucket.
5. En error: `status='failed'` + `error_message` (truncado a 500 chars).

## Decisiones técnicas

- **service_role en lugar de RLS policies** — la app es single-user e interna; centralizar toda la autorización en las API routes simplifica el modelo y evita policies frágiles.
- **Bucket público** — Instagram Graph API debe poder descargar la imagen. Es más simple que firmar URLs y no expone nada que no vaya a salir al feed público igualmente.
- **Cron cada hora** — el plan Hobby de Vercel limita la granularidad a 1h. Si necesitas precisión al minuto, usa Supabase Edge Functions + `pg_cron` (también gratuito).
- **Polling del container** — los stills suelen procesarse en <1 s, pero IG a veces devuelve `IN_PROGRESS`; esperamos hasta ~15 s antes de abortar.

## Próximos pasos (opcionales)

- Auth (Supabase Auth) si más de una persona va a acceder.
- Calendario mensual / historial de `published`.
- Multi-imagen (carousel): Graph API admite containers con `media_type=CAROUSEL` y hasta 10 children.
- Renovación automática del token IG antes de los 60 días.
