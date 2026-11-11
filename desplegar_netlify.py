"""
Motor de Despliegue Automatico a Netlify (La Boda de Luis y Vane)
Sube directamente el frontend a la API oficial de Netlify en segundo plano.
Garantiza headers correctos (text/html) y empaquetado optimizado.
"""

import os
import sys
import io
import time
import zipfile
import json
import urllib.request
import urllib.error

# Forzar UTF-8 en salida de Windows
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def cargar_env(ruta_env=".env"):
    config = {}
    if os.path.exists(ruta_env):
        with open(ruta_env, 'r', encoding='utf-8') as f:
            for linea in f:
                linea = linea.strip()
                if linea and not linea.startswith('#') and '=' in linea:
                    k, v = linea.split('=', 1)
                    config[k.strip()] = v.strip()
    return config

def crear_zip_despliegue(directorio_origen):
    """Crea un ZIP en memoria con los archivos publicables del frontend."""
    zip_buffer = io.BytesIO()
    archivos_permitidos = {'.html', '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.pdf', '.txt', '.toml'}
    archivos_especiales = {'_headers', '_redirects', 'netlify.toml', 'index.html', 'manifest.json'}
    archivos_excluidos = {'.env', '.gitignore', 'desplegar_netlify.py'}

    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for raiz, carpetas, archivos in os.walk(directorio_origen):
            carpetas[:] = [c for c in carpetas if not c.startswith('.') and not c.startswith('_') and c != '__pycache__']
            for archivo in archivos:
                if archivo in archivos_excluidos or archivo.startswith('.'):
                    continue
                ext = os.path.splitext(archivo)[1].lower()
                if archivo in archivos_especiales or ext in archivos_permitidos:
                    ruta_completa = os.path.join(raiz, archivo)
                    ruta_relativa = os.path.relpath(ruta_completa, directorio_origen).replace('\\', '/')
                    
                    with open(ruta_completa, 'rb') as f:
                        datos = f.read()
                    
                    zinfo = zipfile.ZipInfo(ruta_relativa)
                    zinfo.external_attr = 0o644 << 16  # Permisos estándar Unix
                    zinfo.compress_type = zipfile.ZIP_DEFLATED
                    zip_file.writestr(zinfo, datos)
                    print(f"  [+] Empaquetando: {ruta_relativa}")

    zip_buffer.seek(0)
    return zip_buffer.getvalue()

def desplegar(directorio=None):
    t_inicio = time.time()
    print("=" * 65)
    print("🚀 NETLIFY AUTO-DEPLOYER: LA BODA DE LUIS Y VANE")
    print("=" * 65)

    if directorio is None:
        directorio = os.path.dirname(os.path.abspath(__file__))

    ruta_env = os.path.join(directorio, ".env")
    env = cargar_env(ruta_env)

    token = env.get("NETLIFY_AUTH_TOKEN")
    site_id = env.get("NETLIFY_SITE_ID", "dfaa007a-c3de-4a00-be48-6a6b685c92cb")

    if not token:
        print("❌ Error: No se encontró NETLIFY_AUTH_TOKEN en el archivo .env")
        return False

    print(f"📦 Empaquetando archivos desde: {directorio}")
    zip_bytes = crear_zip_despliegue(directorio)
    print(f"📦 Tamaño del paquete: {len(zip_bytes) / 1024:.2f} KB")

    url = f"https://api.netlify.com/api/v1/sites/{site_id}/deploys"
    print(f"🌐 Conectando con API de Netlify: {url}...")

    handler = urllib.request.ProxyHandler({})
    opener = urllib.request.build_opener(handler)

    req = urllib.request.Request(
        url,
        data=zip_bytes,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/zip",
            "User-Agent": "Antigravity-Deployer/1.0"
        },
        method="POST"
    )

    try:
        with opener.open(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            t_total = time.time() - t_inicio
            url_publica = data.get("ssl_url") or data.get("url") or f"https://{data.get('name')}.netlify.app"
            deploy_id = data.get("id")
            estado = data.get("state")

            print("\n" + "=" * 65)
            print("✅ DESPLIEGUE EXITOSO EN NETLIFY")
            print(f"🔗 URL Pública: {url_publica}")
            print(f"🆔 Deploy ID:   {deploy_id}")
            print(f"📊 Estado:      {estado}")
            print(f"⏱️ Tiempo:      {t_total:.2f} segundos")
            print("=" * 65)
            return url_publica
    except urllib.error.HTTPError as e:
        detalles = e.read().decode('utf-8', errors='ignore')
        print(f"\n❌ Error HTTP {e.code}: {e.reason}")
        print(f"Detalles: {detalles}")
        return False
    except Exception as e:
        print(f"\n❌ Error de conexión: {e}")
        return False

if __name__ == "__main__":
    desplegar()
