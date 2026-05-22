"""
Sistema de Agentes Diagnósticos — Muecards
Ejecuta pruebas HTTP en todas las fases y guarda resultados en JSON.
No requiere SDK de Anthropic — el análisis lo realiza Claude directamente.
"""

import json
import os
import sys
import time
import io
from pathlib import Path

# Forzar UTF-8 en la consola de Windows
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")

BASE_URL       = (sys.argv[1] if len(sys.argv) > 1 else os.getenv("MUECARDS_URL", "http://localhost:3000")).rstrip("/")
CRON_SECRET    = os.getenv("CRON_SECRET", "")
AUTH_USERNAME  = os.getenv("AUTH_USERNAME", "")
AUTH_PASSWORD  = os.getenv("AUTH_PASSWORD", "")
AUTH_SECRET    = os.getenv("AUTH_SECRET", "")
IG_ACCESS_TOKEN = os.getenv("IG_ACCESS_TOKEN", "")
IG_USER_ID     = os.getenv("IG_USER_ID", "")
IG_GRAPH_VERSION = os.getenv("IG_GRAPH_VERSION", "v21.0")

# Imagen PNG 1×1 px válida para test de upload
TEST_PNG = bytes([
    0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
    0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,
    0xDE,0x00,0x00,0x00,0x0C,0x49,0x44,0x41,0x54,0x08,0xD7,0x63,0xF8,0xCF,0xC0,0x00,
    0x00,0x00,0x02,0x00,0x01,0xE2,0x21,0xBC,0x33,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,
    0x44,0xAE,0x42,0x60,0x82,
])

SESSION = {"mue_session": AUTH_SECRET}
CRON_HEADERS = {"Authorization": f"Bearer {CRON_SECRET}"}

resultados = {}

# ---------------------------------------------------------------------------
# Utilidad
# ---------------------------------------------------------------------------

def req(method, path, label="", **kwargs):
    url = f"{BASE_URL}{path}"
    try:
        r = requests.request(method, url, timeout=20, **kwargs)
        body = None
        try:
            body = r.json()
        except Exception:
            body = r.text[:500]
        result = {"ok": r.status_code < 400, "status": r.status_code, "body": body}
    except requests.exceptions.ConnectionError:
        result = {"ok": False, "status": 0, "body": "CONNECTION_ERROR — servidor no accesible"}
    except requests.exceptions.Timeout:
        result = {"ok": False, "status": 0, "body": "TIMEOUT — sin respuesta en 20 s"}
    except Exception as e:
        result = {"ok": False, "status": 0, "body": str(e)}

    tag = f"[{'OK' if result['ok'] else 'FAIL'}]"
    print(f"  {tag} {method} {path}" + (f" — {label}" if label else ""))
    return result


# ---------------------------------------------------------------------------
# AGENTE 1 — Auth
# ---------------------------------------------------------------------------
print("\n=== AGENTE 1: AUTENTICACIÓN ===")

resultados["auth"] = {
    "login_valido":       req("POST", "/api/auth/login",
                              label="credenciales correctas",
                              json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD}),
    "login_invalido":     req("POST", "/api/auth/login",
                              label="credenciales incorrectas → debe ser 401",
                              json={"username": "fake", "password": "wrong"}),
    "ruta_sin_sesion":    req("GET",  "/api/posts",
                              label="sin cookie → debe ser 401/302"),
    "ruta_con_sesion":    req("GET",  "/api/posts",
                              label="con cookie válida",
                              cookies=SESSION),
    "env_auth": {
        "AUTH_USERNAME_set": bool(AUTH_USERNAME),
        "AUTH_PASSWORD_set": bool(AUTH_PASSWORD),
        "AUTH_SECRET_set":   bool(AUTH_SECRET),
    }
}

# ---------------------------------------------------------------------------
# AGENTE 2 — Schedule (upload + programación)
# ---------------------------------------------------------------------------
print("\n=== AGENTE 2: SCHEDULE (UPLOAD + DB) ===")

future = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 7200))
past   = "2020-01-01T00:00:00.000Z"

resultados["schedule"] = {
    "upload_imagen_valida": req(
        "POST", "/api/schedule",
        label="PNG válido + caption + fecha futura",
        files={"image": ("test_diag.png", io.BytesIO(TEST_PNG), "image/png")},
        data={"caption": "Diagnóstico automático — agente test", "scheduled_time": future},
        cookies=SESSION,
    ),
    "sin_imagen": req(
        "POST", "/api/schedule",
        label="sin imagen → debe ser 400",
        data={"caption": "Sin imagen", "scheduled_time": future},
        cookies=SESSION,
    ),
    "fecha_pasada": req(
        "POST", "/api/schedule",
        label="fecha pasada → debe ser 400",
        files={"image": ("t.png", io.BytesIO(TEST_PNG), "image/png")},
        data={"caption": "Fecha pasada", "scheduled_time": past},
        cookies=SESSION,
    ),
    "caption_largo": req(
        "POST", "/api/schedule",
        label="caption >2200 chars → debe ser 400",
        files={"image": ("t.png", io.BytesIO(TEST_PNG), "image/png")},
        data={"caption": "X" * 2201, "scheduled_time": future},
        cookies=SESSION,
    ),
    "listar_posts": req("GET", "/api/posts", label="lista posts programados", cookies=SESSION),
}

# ---------------------------------------------------------------------------
# AGENTE 3 — Publish (Instagram)
# ---------------------------------------------------------------------------
print("\n=== AGENTE 3: PUBLISH (INSTAGRAM) ===")

resultados["publish"] = {
    "cron_sin_auth": req("GET", "/api/publish", label="sin CRON_SECRET → debe ser 401"),
    "cron_con_auth": req("GET", "/api/publish", label="con CRON_SECRET válido",
                         headers=CRON_HEADERS),
    "queue_next":    req("GET", "/api/queue-next", label="próximo post pendiente",
                         cookies=SESSION),
    "ig_setup":      req("GET", "/api/ig-setup", label="verificar token IG + user ID",
                         cookies=SESSION),
    "env_ig": {
        "IG_ACCESS_TOKEN_set": bool(IG_ACCESS_TOKEN),
        "IG_ACCESS_TOKEN_prefix": IG_ACCESS_TOKEN[:10] + "..." if IG_ACCESS_TOKEN else "MISSING",
        "IG_USER_ID": IG_USER_ID or "MISSING",
        "IG_GRAPH_VERSION": IG_GRAPH_VERSION,
    }
}

# Verificar token IG directamente contra Graph API
if IG_ACCESS_TOKEN and IG_USER_ID:
    print("  Verificando token IG contra Graph API...")
    try:
        r = requests.get(
            f"https://graph.facebook.com/{IG_GRAPH_VERSION}/{IG_USER_ID}",
            params={"fields": "id,username,account_type", "access_token": IG_ACCESS_TOKEN},
            timeout=15,
        )
        resultados["publish"]["ig_token_directo"] = {
            "ok": r.status_code == 200,
            "status": r.status_code,
            "body": r.json(),
        }
    except Exception as e:
        resultados["publish"]["ig_token_directo"] = {"ok": False, "status": 0, "body": str(e)}
else:
    resultados["publish"]["ig_token_directo"] = {"ok": False, "status": 0, "body": "IG_ACCESS_TOKEN o IG_USER_ID no configurados"}

# ---------------------------------------------------------------------------
# AGENTE 4 — Google Drive
# ---------------------------------------------------------------------------
print("\n=== AGENTE 4: GOOGLE DRIVE ===")

resultados["drive"] = {
    "drive_list":     req("GET", "/api/drive-list", label="listar carpeta Drive",
                          cookies=SESSION),
    "drive_thumbnail": req("GET", "/api/drive-thumbnail?fileId=test_invalid",
                           label="thumbnail con ID inválido → manejo de error",
                           cookies=SESSION),
    "sync_drive":     req("GET", "/api/sync-drive", label="cron sync Drive",
                          headers=CRON_HEADERS),
}

# ---------------------------------------------------------------------------
# AGENTE 5 — Logs
# ---------------------------------------------------------------------------
print("\n=== AGENTE 5: LOGS ===")

resultados["logs"] = {
    "logs_con_sesion": req("GET", "/api/admin/logs", label="logs recientes",
                           cookies=SESSION),
    "logs_sin_sesion": req("GET", "/api/admin/logs", label="sin auth → debe proteger",
                           ),
}

# ---------------------------------------------------------------------------
# Guardar resultados
# ---------------------------------------------------------------------------
OUT = PROJECT_ROOT / "diagnostico" / "resultados_raw.json"
OUT.write_text(json.dumps(resultados, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n[OK] Resultados guardados en {OUT}")
print(json.dumps(resultados, ensure_ascii=False, indent=2))
