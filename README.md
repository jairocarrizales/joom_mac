# Joom 🎥 (macOS)

Grabador de pantalla + webcam para **macOS**, mínimo y directo. Port de la versión
de Windows con **las mismas funcionalidades**, adaptado a Mac (permisos, conversión
de PowerPoint y resolución de binarios).

Construido con **Electron**. La pantalla y la webcam se componen en tiempo real en
un `<canvas>` y se graban con `MediaRecorder`; al detener, `ffmpeg` convierte a MP4
(H.264 + AAC, listo para web).

## Qué hace

- **Tres modos de grabación:**
  - **Pantalla completa** (horizontal) con la webcam como burbuja flotante.
  - **Reel vertical** (9:16, resultado 1080×1920) con la cámara en banda, en
    burbuja o a pantalla completa, y un texto/banner opcional.
  - **Pantalla + cámara vertical** (podcast): la pantalla a la izquierda y la
    cámara vertical a la derecha.
- **Formas de cámara:** círculo, vertical (móvil), horizontal 16:9 o **sin cámara**.
- **Barra de presentación** mientras grabas: puntero **láser**, dibujar
  **rectángulos**, **flechas**, **números** y **confeti** 🎉, con colores y grosor.
- **Reel con medios:** vídeo de YouTube (vía `yt-dlp`), vídeo local, o
  presentación (PDF / PowerPoint / Google Slides) navegable durante la grabación.
- Selector de **calidad** (720p/1080p/1080p60/1440p), **micrófono** y **audio del sistema**.
- Botón para traer la **cámara al frente** y vista previa en vivo opcional.

## Requisitos

- macOS 12+ (Apple Silicon o Intel)
- Node.js 18+
- `ffmpeg` se incluye vía `ffmpeg-static` (con respaldo al `ffmpeg` del PATH)

### Dependencias opcionales (por función)

| Función | Necesitas | Instalar |
|---|---|---|
| Reel con vídeo de **YouTube** | `yt-dlp` | `brew install yt-dlp` |
| Reel con **PowerPoint** (`.pptx`/`.ppt`) | **LibreOffice** o **Keynote** | `brew install --cask libreoffice` |

> La grabación, la cámara, el reel con vídeo/PDF local y Google Slides funcionan
> sin instalar nada extra. `yt-dlp` solo hace falta si pegas una URL de YouTube;
> la app detecta el binario al vuelo (no requiere reiniciar) y avisa si falta.

### Configuración recomendada (la que se usó para validar)

```bash
brew install yt-dlp                 # vídeos de YouTube en el reel
brew install --cask libreoffice    # PowerPoint -> PDF (opcional)
npm install                        # baja Electron + ffmpeg (binario nativo de tu Mac)
```

## Grabación

La pantalla + webcam se componen en un `<canvas>` y se graban con `MediaRecorder`
en **MP4 / H.264 usando el codificador por hardware de macOS (VideoToolbox)**, así
la grabación va siempre en tiempo real (sin cámara lenta). Al detener, `ffmpeg`
solo reempaqueta a MP4 listo para web (`+faststart`), sin recodificar.

## Permisos de macOS

La primera vez la app pedirá acceso a **Cámara** y **Micrófono**. Para la captura
de pantalla, macOS exige conceder **Grabación de pantalla** manualmente:

> Ajustes del Sistema → Privacidad y seguridad → **Grabación de pantalla** →
> activa **Joom** (o **Electron** si lo ejecutas en desarrollo) y reinicia la app.

## Uso

```bash
npm install
npm start
```

## Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl+Shift+R` | Grabar / Detener |
| `Ctrl+Shift+P` | Pausar / Reanudar |
| `Ctrl+Shift+A` | Mostrar/ocultar anotaciones |
| `Ctrl+Shift+L` | Activar/desactivar láser |
| `Ctrl+Shift+C` | Confeti 🎉 |

## Compilar un instalador

```bash
npm run dist
```

Genera un `.dmg` y un `.zip` (arm64 + x64) en `dist/` con `electron-builder --mac`.

> Nota: las apps no firmadas requieren el primer arranque con clic derecho → Abrir,
> o ejecutar `xattr -dr com.apple.quarantine "/Applications/Joom.app"`.

## Cómo funciona (arquitectura)

| Ventana | Archivo | Rol |
|---|---|---|
| Panel de control | `renderer/control.*` | Elegir modo/pantalla/cámara/mic, calidad, opciones de reel, botón de grabar |
| Burbuja flotante | `renderer/overlay.*` | Webcam *always-on-top*, arrastrable y redimensionable. `setContentProtection(true)` la excluye de la captura |
| Compositor (oculto) | `renderer/recorder.*` | Compone pantalla + webcam en un canvas, graba con `MediaRecorder`, transmite chunks a disco |
| Barra de grabación | `renderer/recbar.*` | Pausa/detener + herramientas de anotación para presentar |
| Capa de anotaciones | `renderer/annotate.*` | Láser, rectángulos, flechas, números y confeti sobre la pantalla |
| Selector de zona | `renderer/region.*` | Recuadro de pantalla a mostrar en el reel |
| Proceso principal | `main.js` | Ventanas, IPC, fuente de pantalla, transcodificación a MP4 con ffmpeg |

## Diferencias respecto a la versión de Windows

Mismas funcionalidades; solo cambia lo dependiente del sistema:

- **Permisos:** se solicitan cámara/micrófono con la API de macOS y se documenta el
  permiso de Grabación de pantalla (TCC).
- **PowerPoint → PDF:** en lugar de automatizar PowerPoint por COM, se usa
  **LibreOffice** (`soffice --headless`) y, si no está, **Keynote** (AppleScript).
- **yt-dlp:** se resuelve la ruta absoluta del binario (Homebrew/pipx), porque las
  apps GUI de macOS no heredan el `PATH` del shell.
- **Empaquetado:** `electron-builder --mac` (DMG/ZIP) con *hardened runtime* y
  entitlements de cámara/micrófono.

## Licencia

MIT — Jairo Carrizales
