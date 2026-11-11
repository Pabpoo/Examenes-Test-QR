# Exámenes Test QR

Web instalable para crear exámenes tipo test, generar su PDF con hoja de respuestas y corregirlos con la cámara del
móvil. Proyecto personal de Pablo para su pareja, profesora de Enfermería en la universidad, y algún compañero suyo.
Coste cero: todo en el plan gratuito de Cloudflare (Worker + D1).

**Antes de tocar nada, lee `docs/ESPECIFICACION.md`.** Ahí están las decisiones cerradas, la arquitectura, las
fases con sus criterios de aceptación y las pruebas exigidas.

## Papeles

- Pablo decide.
- Fable hace de arquitecto y de QA: escribió la especificación y revisa cada fase.
- Opus programa. Al terminar cada fase se detiene, resume lo hecho y lo que no ha podido verificar, y espera la
  revisión.

## Reglas

- Las decisiones del apartado 2 de la especificación no se cambian sin Pablo. Si la implementación se aparta del
  documento, se anota en su registro de cambios.
- Principio del escáner: mejor una duda que un error. Nunca dar por buena una marca ambigua.
- Las fotos de los exámenes no salen del móvil. Sin datos personales en registros ni en pruebas (usar datos
  inventados).
- No hacer commits hasta que Pablo lo pida; el push lo decide él. Mensajes cortos, en castellano y con tono de
  persona, sin coautoría ni atribución.
- El primer despliegue y cualquier acción hacia fuera, con permiso de Pablo. Antes hace falta que él ejecute
  `npx wrangler login`.
- Cloudflare y GitHub van con la cuenta **personal** de Pablo (la de su GitHub `Pabpoo`), nunca con el correo del
  trabajo con el que tiene Claude. Antes de cualquier despliegue, ejecutar `npx wrangler whoami` y confirmar con
  él que la cuenta es la personal. Lo mismo con el correo de git antes del primer commit.
- Comprobar en la documentación actual la configuración de Cloudflare y las versiones de las librerías (plugin
  `cloudflare`, Context7 si está autorizado).
- `DOCUMENTACION-CLAUDE.md` nunca se sube: ya está en `.gitignore`.

## Entorno

Windows 11, PowerShell y Git Bash. Node 26 y npm 10. Wrangler no está instalado de forma global: usarlo como
dependencia del proyecto con `npx`. Móvil de pruebas: Android (Realme).

## Órdenes

- `npm run dev`: web en local. `npm run dev:movil`: igual pero con HTTPS y accesible desde el móvil en la red local.
- `npm test`: pruebas (Vitest). `npm run typecheck`: tipos (web y Worker por separado).
- `npm run bench:escaner -- [casos] [semilla]`: banco sintético del escáner; resultado en `tests/bench/out/`.
  Herramientas de depuración en `tests/bench/` (`analyze`, `timing`, `perturb-check`, `dump-*`), con `npx tsx`.
- `npm run deploy`: compilar y desplegar (solo con permiso de Pablo).
- npm 10.2 de esta máquina falla al instalar algunos paquetes («edgesOut»): usar `npx -y npm@11.6.2 install …`.

El estado de la fase en curso está al final de `docs/ESPECIFICACION.md`.
