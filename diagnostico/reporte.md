# REPORTE DIAGNÓSTICO — MUECARDS
**Fecha:** 2026-05-22 | **URL analizada:** https://muecards2.vercel.app

---

## RESUMEN EJECUTIVO

La autenticación, el upload de imágenes y la conexión con Supabase funcionan correctamente. 
**El problema principal es que el token de Instagram expiró ayer** y ningún post podrá publicarse hasta renovarlo.
Adicionalmente, el cron de sincronización de Drive llevaba tiempo sin ejecutarse debido a un bug en el middleware,
lo que dejó 4 posts con URLs inválidas que Instagram rechaza. **3 de estos 4 bugs ya han sido corregidos** en el código.

---

## ESTADO POR FASE

| Fase | Estado | Detalle |
|------|--------|---------|
| **Auth** | ✅ OK | Login, cookies y rutas protegidas funcionan correctamente |
| **Schedule** | ✅ OK | Upload de imágenes, validaciones y Supabase Storage operativos |
| **Publish** | 🔴 ROTO | Token Instagram expirado el 21-May-26 — requiere acción manual |
| **Drive Sync** | 🔴 ROTO (fix aplicado) | Cron bloqueado por middleware — corregido en este deploy |
| **Logs** | 🟠 ROTO (fix aplicado) | Tabla `app_logs` inexistente en Supabase — SQL de migración incluido |

---

## PROBLEMAS CRÍTICOS

### 🔴 #1 — TOKEN DE INSTAGRAM EXPIRADO
**Impacto:** Ningún post se puede publicar desde el 21 de Mayo de 2026.

**Error exacto:**
```
OAuthException (code 190, subcode 463):
"Session has expired on Thursday, 21-May-26 04:00:00 PDT.
 The current time is Friday, 22-May-26 01:39:32 PDT."
```

**Causa raíz:** Los tokens Long-Lived de Instagram tienen 60 días de vida. El token se generó alrededor del 22 de Marzo y expiró el 21 de Mayo. Los posts de Marina Angemon (23 Mayo) y Veemon (24 Mayo) ya están condenados a fallar si no se renueva el token antes.

**Solución (requiere acción manual):**
1. Ir a [Meta for Developers](https://developers.facebook.com) → Tu App → Herramientas de Graph API
2. Generar un nuevo User Access Token con los permisos: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`
3. Intercambiarlo por un Long-Lived Token (60 días):
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={app-id}
     &client_secret={app-secret}
     &fb_exchange_token={short-lived-token}
   ```
4. Actualizar `IG_ACCESS_TOKEN` en Vercel → Settings → Environment Variables
5. Hacer redeploy

---

### 🔴 #2 — CRON `sync-drive` BLOQUEADO POR MIDDLEWARE (CORREGIDO)
**Impacto:** El cron de Vercel que resuelve las imágenes de Drive nunca se ejecutó, dejando 4 posts con URLs relativas que Instagram rechaza.

**Causa raíz:** El matcher del middleware en `middleware.ts` no incluía `api/cron` en su lista de exclusiones. Cuando Vercel llamaba a `GET /api/cron/sync-drive` cada mañana a las 7:00 AM, el middleware lo interceptaba, no encontraba la cookie `mue_session` (los crons no tienen cookies) y redirigía a `/login`. El endpoint nunca se ejecutó.

**Error que producía en los posts:**
```
"IG media create failed: Only photo or video can be accepted as media type."
```
(Instagram recibía una URL relativa `/api/drive-thumbnail?id=...` que no puede resolver)

**Fix aplicado en `middleware.ts`:**
```diff
- '/((?!login|api/auth|api/publish|...'
+ '/((?!login|api/auth|api/publish|api/cron|...'
```

---

### 🔴 #3 — 4 POSTS DE DRIVE CON STATUS `failed` (CORREGIDO)
**Posts afectados:**
- `id: 60127fce` — Psyduck promo — 22 Mayo
- `id: 7e457a01` — Psyduck promo — 22 Mayo  
- `id: c6413ecd` — Psyduck promo — 22 Mayo
- Un post de Drive de Psyduck adicional

**Causa raíz:** Consecuencia directa del Bug #2. Los posts tienen `storage_path = drive:1x_XQi-fFD-iimurz8Fj06MPhfPqUZwBp:image/heif` pero `status = failed`. El cron Phase A solo procesaba posts con `status = pending`, por lo que estos posts nunca serían reintentados.

**Fix aplicado en `/api/cron/sync-drive`:**
```diff
- .eq('status', 'pending')
+ .in('status', ['pending', 'failed'])
```
Y al resolver exitosamente un post de Drive, ahora también resetea `status` a `pending` y limpia `error_message`.

---

## PROBLEMAS MENORES

### 🟠 #4 — TABLA `app_logs` INEXISTENTE EN SUPABASE (PENDIENTE MIGRACIÓN)
**Impacto:** `/api/admin/logs` devuelve 500. El sistema de logs está completamente ciego.

**Error exacto:**
```
"Could not find the table 'public.app_logs' in the schema cache"
```

**Causa raíz:** La tabla se usa en `lib/logger.ts` pero no estaba en `supabase/schema.sql`. Ya fue añadida al schema.

**Acción requerida:** Ejecutar este SQL en Supabase SQL Editor:
```sql
CREATE TABLE IF NOT EXISTS public.app_logs (
  id         BIGSERIAL   PRIMARY KEY,
  level      TEXT        NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  route      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_logs_created_at_idx ON public.app_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS app_logs_level_idx      ON public.app_logs (level);

ALTER TABLE public.app_logs ENABLE ROW LEVEL SECURITY;
```

---

### 🟡 #5 — POSTS DUPLICADOS EN LA BASE DE DATOS
**Impacto:** Bajo — posts ya publicados con éxito, no generan problemas operativos.

Los mismos posts (Psyduck, Marine Angemon, Veemon) fueron subidos varias veces, probablemente como intentos de solucionar los fallos manuales. Hay entre 3 y 5 versiones de cada uno. Los `published` ya están en Instagram, los `pending` publicarán cuando llegue su fecha.

---

### 🟡 #6 — POSTS CON FECHA 2099
**Impacto:** Bajo — funcionan, pero requieren asignarles fecha manualmente.

Los posts subidos por el flujo `/api/sync-drive` (importación masiva legacy) reciben `scheduled_time = 2099-01-01` como placeholder. Estos **no se publicarán automáticamente** hasta que el usuario les asigne una fecha real desde el dashboard.

Posts afectados: 8 posts (Psyduck, Marine Angemon, Veemon_baby en `local_queued/`)

---

## PASOS DE CORRECCIÓN INMEDIATA

### Paso 1 — URGENTE: Renovar token de Instagram
```
Meta for Developers → Graph API Explorer → generar token → exchange por long-lived
→ Vercel Settings → Environment Variables → IG_ACCESS_TOKEN → Save → Redeploy
```
**Sin esto, NADA se publica.**

### Paso 2 — Crear tabla app_logs en Supabase  
```
Supabase → SQL Editor → pegar el SQL del problema #4 → Run
```
Esto activa el sistema de logs y permite monitorear errores futuros.

### Paso 3 — Deploy del código corregido
El repo ya tiene 3 fixes aplicados:
- `middleware.ts` — cron desprotegido
- `supabase/schema.sql` — tabla app_logs añadida
- `app/api/cron/sync-drive/route.ts` — también reintenta posts `failed`

```bash
git add middleware.ts supabase/schema.sql app/api/cron/sync-drive/route.ts
git commit -m "fix: desbloquear cron en middleware, añadir app_logs, reintentar drive posts fallados"
git push
```
Vercel desplegará automáticamente.

### Paso 4 — El cron de mañana a las 7AM (automático tras el deploy)
Con el middleware corregido y el token renovado, el cron `GET /api/cron/sync-drive` se ejecutará y:
- Descargará las 4 imágenes HEIC de Drive
- Las convertirá a JPEG
- Las subirá a Supabase Storage
- Actualizará los 4 posts fallados a `status = pending` con URL real

### Paso 5 — El cron de publicación a las 8AM
Una vez los Drive posts tengan URL real, el cron de publicación los encontrará con `status = pending` y los publicará en Instagram.

---

## VARIABLES DE ENTORNO A REVISAR

| Variable | Estado | Acción |
|----------|--------|--------|
| `IG_ACCESS_TOKEN` | ❌ EXPIRADO | Renovar con un nuevo long-lived token |
| `CRON_SECRET` | ✅ Configurado | Sin cambios |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Funcional | Sin cambios |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ✅ Funcional (Drive lista archivos OK) | Sin cambios |
| `AUTH_SECRET` / `AUTH_USERNAME` / `AUTH_PASSWORD` | ✅ OK | Sin cambios |

---

## RESUMEN DE CÓDIGO MODIFICADO

| Archivo | Cambio |
|---------|--------|
| `middleware.ts` | Añadido `api/cron` a la lista de exclusión del matcher |
| `supabase/schema.sql` | Añadida tabla `app_logs` con índices |
| `app/api/cron/sync-drive/route.ts` | Phase A ahora también procesa posts `failed` con path `drive:` y los resetea a `pending` |
