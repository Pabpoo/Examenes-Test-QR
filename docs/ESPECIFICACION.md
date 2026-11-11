# Exámenes Test QR: especificación

Versión 1 del 11/11/2026. Escrita por el arquitecto (Fable) para el programador (Opus). Pablo decide; el
arquitecto hace además de QA al final de cada fase.

## 1. Qué es

Una web instalable (PWA) para que una profesora de universidad (Enfermería) y, como mucho, unos pocos compañeros:

1. Creen exámenes tipo test desde el ordenador (también se puede desde el móvil).
2. Descarguen un PDF cuya primera página es la hoja de respuestas y el resto las preguntas.
3. Corrijan apuntando con la cámara del móvil a la hoja de respuestas de cada alumno.
4. Vean las notas por alumno y las exporten a Excel.

No se publica en tiendas ni tiene registro abierto. Grupos de 60 a 80 alumnos, todos mayores de edad. Coste cero.

## 2. Decisiones cerradas

Cambiar cualquiera de estas requiere el visto bueno de Pablo.

| Tema | Decisión |
|---|---|
| Tipo de app | Web PWA única para ordenador y móvil. Sin app nativa. |
| Alojamiento | Todo en Cloudflare, plan gratuito: un Worker con archivos estáticos + API, y D1. Dominio `*.workers.dev`. |
| Acceso | Cuentas cerradas: las crea el administrador (Pablo). Correo y contraseña. Sin registro ni correos. |
| Lectura de la hoja | En el propio móvil. Las imágenes no se suben ni se guardan en el servidor. |
| Identificar el examen | Un QR en la hoja. No se elige el examen a mano. |
| Identificar al alumno | Código numérico de longitud fija que el profesor configura por clase (2 a 8 cifras; lo habitual, cifras del DNI sin letra). |
| Opciones por pregunta | De 2 a 6. Una o varias correctas. |
| Puntuación | Configurable por examen. En preguntas con varias correctas, el criterio se elige por pregunta (ver §9). |
| Modelos | De 1 a 4 por examen (A, B, C, D), barajando preguntas, opciones o ambas. Un PDF y un QR por modelo (ver §6). |
| Marcas dudosas | Nunca se adivina: se pregunta al profesor en una pantalla de dudas (ver §7.4). |
| Qué se guarda de cada corrección | Lo que marcó el alumno en cada pregunta. La nota se calcula siempre, no se almacena. |
| Examen impreso | Al generar el PDF se congela una versión. Lo impreso no cambia; la clave y la puntuación sí pueden corregirse después. |
| Más preguntas de las que caben | Varias hojas de respuestas por alumno, cada una con su QR y su bloque de identificación. |
| Contenido de las preguntas | Solo texto por ahora. Imágenes más adelante (dejar el modelo preparado, sin implementarlo). |
| Idioma | Interfaz en castellano. |
| Navegadores | Crear exámenes, PDF y resultados: Edge (el que más usa la profesora), Chrome y Firefox en portátil. Escanear: Chrome y Firefox en Android (ver §7.3). |

## 3. Arquitectura

Un solo proyecto y un solo despliegue.

- **Web**: React + Vite + TypeScript, como SPA y PWA (manifest y service worker). Se compila a estáticos que sirve
  el Worker.
- **API**: el mismo Worker, con Hono, bajo `/api/*`. Base de datos D1 con el binding `DB`.
- **Lógica compartida** en TypeScript puro (sin DOM ni APIs de Workers), usada por web, API y pruebas:
  puntuación, geometría de la hoja, formato del QR.
- **Escáner**: módulo TypeScript puro que recibe píxeles (`{data, width, height}`) y devuelve la lectura. No toca
  la cámara ni el DOM, para poder probarlo en Node.
- **PDF**: se genera en el navegador con `pdf-lib` y una fuente Unicode incrustada (por ejemplo Noto Sans normal y
  negrita), porque en Enfermería aparecen símbolos como ≥, ≤ o µ que las fuentes estándar del PDF no cubren.
- **Excel**: se genera en el navegador. La importación de alumnos se hace pegando desde Excel (texto separado por
  tabuladores) o CSV, sin librería.

Las versiones de las librerías y la configuración exacta de Cloudflare (plugin de Vite, `wrangler.jsonc`, archivos
estáticos con modo SPA, D1 en la UE) hay que comprobarlas en la documentación actual antes de escribirlas; no fiarse
de la memoria.

### Estructura del repositorio

```
CLAUDE.md
docs/ESPECIFICACION.md
wrangler.jsonc, vite.config.ts, package.json
migrations/          SQL de D1
src/shared/          tipos, puntuación, geometría de la hoja, QR (TS puro)
src/scanner/         marcadores, homografía, rectificado, lectura de burbujas (TS puro)
src/pdf/             hoja de respuestas y paginado del examen
src/worker/          API con Hono, sesiones, consultas a D1
src/web/             aplicación React
tests/               pruebas unitarias, banco sintético del escáner, fotos reales de prueba
```

## 4. Modelo de datos (D1)

Fechas como texto ISO en UTC. Identificadores internos aleatorios. Borrados en cascada.

- **users**: id, email (único), nombre, hash y sal de la contraseña, rol (`admin` o `profesor`), desactivado.
- **sessions**: hash del token, user_id, caducidad.
- **classes** (clases o grupos): id, user_id, nombre, `id_digits` (2 a 8), `id_label` (texto que se imprime, por
  ejemplo «Últimas 5 cifras del DNI»), archivada.
- **students**: id, class_id, `code` (texto, solo cifras, exactamente `id_digits`), apellidos, nombre.
  Único por (class_id, code).
- **exams**: id, user_id, título, asignatura, instrucciones, configuración de puntuación (JSON), fechas.
- **exam_questions** (borrador editable): id, exam_id, posición, enunciado, opciones (JSON: lista de
  `{texto, correcta}`), `no_barajar` (las opciones conservan su orden en todos los modelos; para preguntas con
  «todas las anteriores» o «a y b son correctas») y criterio si tiene varias correctas (§9).
- **exam_classes**: exam_id, class_id. Un examen se asocia a una o varias clases.
- **exam_versions** (lo que se imprimió): id público corto (8 caracteres en mayúsculas y cifras, va en el QR),
  exam_id, número, fecha y:
  - `snapshot` (JSON, **inmutable**): título, preguntas con sus opciones en el orden impreso.
  - `models` (JSON, inmutable): lista de modelos, cada uno con el orden de sus preguntas y de las opciones de cada
    pregunta. El modelo `A` lleva siempre el orden original.
  - `layout` (JSON, inmutable): geometría de las hojas de respuestas de cada modelo tal como se imprimieron (§5).
    Cambia de un modelo a otro porque las preguntas no tienen todas el mismo número de opciones.
  - `key` (JSON, **editable**): por pregunta, qué opciones son correctas, el criterio si hay varias (§9) y si está
    anulada. Siempre en el orden original, no en el de cada modelo.
- **scans** (hojas leídas): id, exam_version_id, modelo, página, student_id, `marks` (JSON: por pregunta, las
  opciones dadas por marcadas tras resolver las dudas, en el orden original, no en el del modelo), `detected`
  (JSON: nivel de relleno de cada burbuja y clasificación automática, para auditoría), fecha, quién escaneó.
  Único por (exam_version_id, student_id, página).

Reglas:

- Cada consulta filtra por el usuario propietario. Ningún profesor ve datos de otro.
- Si se edita un examen ya impreso y se vuelve a generar el PDF, se crea otra versión. Los resultados pertenecen a
  su versión. Avisar si la versión anterior ya tiene hojas leídas.
- Borrar una clase borra sus alumnos y sus hojas leídas, previa confirmación.

## 5. Hoja de respuestas

A4 vertical. Toda la geometría sale de un único módulo (`src/shared`) que devuelve posiciones en milímetros. Lo usan
el generador del PDF, el escáner y las pruebas. El resultado se guarda en `exam_versions.layout`, de modo que el
escáner lee siempre con la geometría que se imprimió aunque el código cambie después.

### Elementos fijos (marco `TQ1`)

Iguales en todas las hojas, porque el escáner los necesita antes de saber qué examen es:

- **Cuatro marcadores tipo ArUco** en las esquinas, cada uno con un identificador distinto (0 arriba izquierda,
  1 arriba derecha, 2 abajo derecha, 3 abajo izquierda), de unos 12 mm y con margen blanco alrededor. A 8 mm o más
  del borde del papel, por los márgenes de las impresoras.
- **QR** en posición fija, arriba a la derecha, de unos 24 mm, con corrección de errores media o alta.
- La esquina superior izquierda es zona de grapa: el escáner debe funcionar con tres marcadores.

Contenido del QR, en modo alfanumérico para que sea pequeño: `TQ1-<id de versión>-<modelo><página>`, por ejemplo
`TQ1-K3F9X2AB-A1`.

Cualquier móvil puede leer un QR, y eso no se puede impedir. Por eso el QR solo lleva ese código: nunca la clave,
ni un enlace, ni nada que le sirva a un alumno. Las respuestas solo las devuelve la API a un profesor con sesión
iniciada y dueño del examen.

### Elementos variables

- Cabecera: título del examen, asignatura, línea para apellidos y nombre, «Hoja 1 de 2» si hay varias.
- **Bloque de identificación**: `id_digits` columnas de diez burbujas (0 a 9), con una casilla encima de cada
  columna para escribir la cifra a mano, y la etiqueta de la clase.
- **Respuestas**: en columnas, con el número de pregunta y solo tantas burbujas como opciones tenga esa pregunta.
  Letra dentro de la burbuja en gris claro. Separación visual cada cinco preguntas.
- Instrucciones breves para el alumno: rellenar la burbuja entera, con bolígrafo azul o negro.

Valores de partida, a ajustar en la fase 0: burbuja de 4,6 mm, paso horizontal de 6,5 mm y vertical de 6,2 mm. El
módulo calcula cuántas columnas caben según el máximo de opciones y expone la capacidad por hoja. Objetivo: unas 80
preguntas por hoja con 6 opciones y más de 100 con 4. Si el examen supera la capacidad, se generan más hojas.

## 6. PDF del examen

- Primero la hoja u hojas de respuestas; después las preguntas.
- Cada pregunta (enunciado y opciones) es un bloque que no se parte entre páginas. El paginado es una función
  pura: recibe los bloques medidos y devuelve en qué página y posición va cada uno. Si un bloque no cabe en lo que
  queda de página, pasa a la siguiente. Solo si una pregunta es más alta que una página entera se permite partirla,
  avisando al profesor.
- Opciones con letra: a), b), c)… Pie con título y «página x de y».
- Opción «dejar en blanco el reverso de la hoja de respuestas», para imprimir a doble cara.
- Opción de descargar solo la hoja de respuestas.
- El QR y los marcadores se dibujan como vectores, no como imagen.

### Modelos

- Al generar el PDF el profesor elige cuántos modelos quiere (1 a 4) y qué se baraja: el orden de las preguntas,
  el de las opciones o ambos. Las preguntas con `no_barajar` conservan el orden de sus opciones.
- Se genera un PDF por modelo, con nombre `<título> - Modelo A.pdf`, `… - Modelo B.pdf`, etc. Con un solo modelo
  el nombre no lleva sufijo.
- La letra del modelo va impresa bien visible en la hoja de respuestas y en la cabecera de las preguntas, y dentro
  del QR. El escáner sabe qué modelo es sin que el profesor lo indique.
- Todos los modelos pertenecen a la misma versión: los resultados, las estadísticas y el Excel son comunes, con
  las respuestas traducidas al orden original.
- El barajado se guarda en la versión; no se recalcula nunca.

## 7. Escáner

### 7.1 Principio

**Mejor una duda que un error.** El fallo que no se admite es leer mal una marca sin avisar. Todo lo ambiguo va a
la pantalla de dudas.

El escáner no busca burbujas: endereza la hoja con los marcadores y mide el relleno en las posiciones que dice la
geometría guardada.

### 7.2 Pasos

1. Imagen en gris y reducida; detección de los marcadores. Hacen falta al menos tres de los cuatro.
2. Control de calidad: la hoja ocupa suficiente imagen, no está movida (nitidez) ni demasiado inclinada.
3. Homografía con las esquinas de todos los marcadores detectados y rectificado de la imagen a resolución completa
   a una escala fija (unos 6 píxeles por milímetro).
4. Normalización de la iluminación (sombras, degradados).
5. Lectura del QR en su zona fija de la imagen rectificada. Con el id de versión se obtiene la geometría y la
   clave (se guardan en caché tras la primera lectura).
6. Por cada burbuja, nivel de oscuridad en el disco interior, sin el trazo del borde. Se normaliza respecto al
   propio papel: la mayoría de las burbujas están vacías, así que la mediana de la hoja sirve de referencia de
   «vacía».
7. Clasificación de cada burbuja: vacía, marcada o dudosa, con dos umbrales que se calibran en la fase 0.
8. Reglas por pregunta y para el identificador (§7.4).

Librerías: empezar con `js-aruco2` para los marcadores y `jsQR` para el QR. Si no se alcanzan los criterios de la
fase 0, se puede cambiar de librería (por ejemplo OpenCV.js) sin tocar la interfaz del módulo. El proceso pesado
va en un Web Worker si bloquea la interfaz.

### 7.3 Captura

- Una sola captura lo lee todo: marcadores, QR, identificador y respuestas salen de la misma imagen. No hay un
  paso previo de «escanear el QR». Por eso las hojas se pueden corregir en cualquier orden, mezclando modelos,
  alumnos e incluso exámenes distintos: cada hoja dice sola qué es.
- Vista previa de la cámara trasera con contorno guía. Disparo automático cuando hay marcadores, la imagen es
  nítida y está estable durante medio segundo. También botón de disparo manual y linterna si el móvil la ofrece.
- Alternativa «subir foto», para móviles donde falle la cámara, para el ordenador y para pruebas.
- Navegadores del móvil: Chrome y Firefox en Android. Si se abre desde el buscador de Google u otra aplicación, la
  página puede cargarse en un navegador interno sin acceso a la cámara. En ese caso la app no falla en silencio:
  explica que no hay cámara, ofrece abrirla en Chrome y deja usar «subir foto». Lo recomendado, y lo que la app
  propone la primera vez, es instalarla en la pantalla de inicio para entrar siempre igual.
- Tras guardar, vuelve a la cámara para el siguiente alumno. Contador de hojas leídas y pendientes.

### 7.4 Dudas

Motivos de duda en una pregunta:

- **Marca débil**: alguna burbuja queda entre los dos umbrales.
- **Marcas de más**: la pregunta espera una sola marca (tiene una única correcta, o varias con el criterio
  `cualquiera`) y hay dos o más burbujas marcadas (posible rectificación del alumno).

Una pregunta sin ninguna marca ni rastro es «en blanco», no una duda.

Motivos de duda en el identificador: alguna columna sin marca o con varias; el código no existe en las clases del
examen; el código existe en más de una clase; ese alumno ya tiene esa hoja leída.

Pantalla de dudas, una pregunta cada vez:

- Recorte ampliado de la fila tal como la marcó el alumno.
- El motivo de la duda en una frase.
- Las opciones como botones, con el estado detectado y las dudosas resaltadas. El profesor deja marcadas las que
  considere.
- La respuesta correcta según la clave, a la vista.
- Para el identificador: recorte del bloque y del nombre escrito a mano, y lista de alumnos de la clase con buscador,
  primero los que aún no tienen hoja. Si el alumno ya tenía esa hoja: sustituir o cancelar.

Después, pantalla resumen: alumno, nota, aciertos, fallos y blancos, e imagen de la hoja con las marcas superpuestas
en verde y rojo. Botones «Guardar y siguiente» y «Repetir».

### 7.5 Varias hojas por alumno

Cada hoja se lee por separado y en cualquier orden. El resultado de un alumno está completo cuando tiene todas las
hojas de su versión. Si falta alguna, se muestra «falta la hoja 2» y no se da nota definitiva: una hoja sin leer no
equivale a preguntas en blanco.

## 8. Resultados

- Lista por examen: alumno, código, nota, aciertos, fallos, blancos, estado (completo, falta hoja, sin corregir).
- Detalle del alumno: sus respuestas pregunta a pregunta, editables a mano.
- **Corregir la clave después**: cambiar las correctas de una pregunta o anularla. Todas las notas se recalculan al
  momento, sin volver a escanear.
- Estadísticas por pregunta: porcentaje de aciertos y reparto de respuestas por opción.
- Excel: una hoja con las notas y otra con las respuestas de cada alumno pregunta a pregunta.

## 9. Puntuación

Función pura en `src/shared`. Configuración por examen:

- `notaMaxima` (por defecto 10) y decimales (por defecto 2).
- `penalizacion`: `ninguna`, `automatica` (1/(k−1), con k opciones en esa pregunta) o `fija` (un valor, por
  ejemplo 0,25).
- `criterioVariasCorrectas`: valor por defecto para las preguntas con más de una correcta. Por defecto,
  `cualquiera`.
- `formulaParcial`: cómo puntúan las preguntas con criterio `parcial`. `resta` (por defecto) o `anula`.

Cada pregunta con más de una correcta tiene su propio criterio, que el profesor elige al crearla (solo se muestra
en ese caso) y puede cambiar después de corregir, porque forma parte de la clave:

- `cualquiera`: basta con marcar una de las correctas. Es el caso habitual: «a y b se dan por válidas». También
  sirve para arreglar una pregunta ambigua tras una reclamación.
- `todas`: hay que marcar exactamente todas las correctas.
- `parcial`: puntuación proporcional.

Cálculo por pregunta, sobre 1 punto:

- Sin marcas: 0.
- Una sola correcta, o criterio `todas`: 1 si lo marcado coincide exactamente con las correctas; si no, se resta
  la penalización.
- `cualquiera`: 1 si hay al menos una marca y todo lo marcado es correcto; si hay alguna incorrecta marcada, se
  resta la penalización.
- `parcial`, según `formulaParcial`:
  - `resta`: (correctas marcadas − incorrectas marcadas) / número de correctas, sin bajar de 0. Con dos correctas,
    marcar una correcta y una incorrecta da 0.
  - `anula`: correctas marcadas / número de correctas, pero cualquier incorrecta marcada deja la pregunta en 0.
    Con dos correctas, marcar solo una da 0,5; marcar una correcta y una incorrecta da 0.

La profesora elige la fórmula en la configuración del examen. Cada opción se explica en la propia pantalla con un
ejemplo calculado sobre una pregunta de muestra, no con la fórmula. Como la nota se calcula siempre, puede cambiarla
después de corregir y ver las notas recalculadas antes de quedarse con una. Añadir más fórmulas en el futuro es
añadir un caso a la función de puntuación.

Nota = máximo(0, suma de las preguntas) / preguntas no anuladas × `notaMaxima`. Las anuladas no cuentan.

No se ofrece una fórmula que ignore las incorrectas marcadas: el alumno sacaría la máxima nota marcándolo todo.

## 10. API

REST con JSON bajo `/api`. A título orientativo:

- Sesión: entrar, salir, quién soy. Usuarios (solo administrador): crear, desactivar, cambiar contraseña.
- Clases y alumnos: alta, edición, borrado e importación en bloque. La importación rechaza códigos repetidos o de
  longitud incorrecta y dice cuáles.
- Exámenes: alta, edición del borrador con sus preguntas, clases asociadas, puntuación.
- Versiones: congelar (devuelve lo necesario para el PDF); obtener por id público (para el escáner: snapshot,
  geometría, clave y alumnos de las clases asociadas); editar la clave.
- Hojas leídas: guardar (sustituye si ya existía), editar, borrar. Resultados de un examen.

## 11. Seguridad y datos personales

- Contraseñas con PBKDF2 mediante WebCrypto y sal por usuario. Comprobar en el despliegue real que cabe en el
  límite de CPU del plan gratuito. Es el mismo patrón que Pablo ya usó en Gesanit; no leer ese proyecto sin que él
  lo autorice.
- Sesión en cookie `HttpOnly`, `Secure`, `SameSite=Lax`, con caducidad. Bloqueo temporal tras varios intentos
  fallidos. Comprobación de origen en las peticiones que modifican datos.
- El primer administrador se crea con un script local, no desde la web.
- Solo consultas preparadas. Sin datos personales en los registros.
- Datos mínimos de los alumnos: nombre, apellidos y código. Base de datos en la UE si D1 lo permite en el plan
  gratuito (comprobarlo).
- Las fotos de los exámenes no salen del móvil.

## 12. Fases

Al terminar cada fase, el programador se detiene, resume lo hecho y lo que no ha podido verificar, y espera la
revisión de QA. No se empieza la siguiente sin ella.

### Fase 0: validar el escáner

Lo único con riesgo técnico; va primero y sin base de datos ni cuentas.

- Módulo de geometría, PDF de la hoja de respuestas y módulo del escáner.
- Banco de pruebas sintético (§13).
- Una página mínima con cámara y «subir foto» que muestre la lectura superpuesta, desplegada para probarla con el
  móvil real (la cámara exige HTTPS).

Criterios de aceptación:

- Banco sintético: 500 casos o más, ningún error silencioso, y menos del 2 % de burbujas bien rellenadas enviadas
  a duda.
- Fotos reales: 30 o más fotos hechas por Pablo con su Realme, de al menos 5 hojas impresas y rellenadas de formas
  distintas (bolígrafo azul y negro, lápiz, aspas, tachones). Ningún error silencioso. La hoja se detecta a la
  primera en el 95 % de los casos. Menos de 1,5 segundos de la captura al resultado.
- La cámara funciona en el Realme con Chrome y con Firefox, y abriendo la dirección desde el buscador de Google se
  llega a poder escanear o se muestra el aviso de §7.3.
- Capacidad real de la hoja medida y anotada aquí.

### Fase 1: base de la aplicación

Cuentas y sesiones, clases y alumnos con importación, exámenes con sus preguntas y puntuación, congelado de
versiones y PDF completo del examen.

Aceptación: pruebas de puntuación y de paginado en verde; prueba de que un usuario no accede a datos de otro; un
examen de 60 preguntas genera un PDF sin preguntas partidas; importar 80 alumnos pegando desde Excel.

### Fase 2: corregir

Flujo de escaneo integrado, pantalla de dudas, resumen, resultados, edición manual, corrección de la clave con
recálculo y Excel.

Aceptación: corregir de principio a fin un examen real de prueba con 10 hojas; anular una pregunta y ver las notas
recalculadas; el Excel abre bien y cuadra con la pantalla.

### Fase 3: ampliaciones

Por este orden: modelos barajados (§6), varias hojas por alumno, estadísticas por pregunta, copia de seguridad descargable, pulido
de la PWA (instalación, caché de la aplicación, reintento si falla la red al guardar).

### Más adelante

Imágenes en las preguntas, banco de preguntas reutilizable, corrección sin conexión.

## 13. Pruebas

- **Puntuación**: tabla de casos con todas las combinaciones de penalización y de varias correctas, preguntas
  anuladas y exámenes en blanco.
- **Geometría**: ninguna burbuja se solapa con otra ni se sale del área útil; la capacidad declarada coincide con
  lo colocado; mismos datos de entrada, misma geometría.
- **Paginado**: con textos de longitudes aleatorias, ningún bloque cruza un salto de página y no se pierde ni se
  repite ninguna pregunta.
- **Escáner, banco sintético**: se dibuja la hoja a partir de la geometría, se rellenan burbujas al azar con
  distintos estilos (relleno completo, parcial, aspa, punto, tachón) y se deforma la imagen: giro en cualquier
  ángulo incluida boca abajo, perspectiva de hasta 30°, desenfoque, ruido, degradado de luz, sombra parcial,
  compresión JPEG y un marcador tapado. Se compara la lectura con lo que se rellenó. Con semilla fija para que
  sea reproducible.
- **Escáner, fotos reales**: en `tests/fixtures/fotos/`, cada foto con un JSON de lo que debe leerse. Solo hojas de
  prueba con datos inventados.
- **API**: acceso cruzado entre usuarios denegado, sesión caducada, bloqueo por intentos, importación con códigos
  repetidos.

- **Navegadores**: las pruebas de extremo a extremo de la parte de portátil (crear examen, generar PDF, ver
  resultados, Excel) se pasan con Playwright en Edge, Chromium y Firefox. La descarga del PDF y del Excel se
  comprueba en los tres. El banco sintético incluye lotes con hojas
  de modelos distintos mezcladas.

Error silencioso: una burbuja leída de forma distinta a la real sin que la pregunta quede marcada como dudosa.

## 14. Reglas de trabajo

- Las decisiones del §2 no se cambian sin Pablo. Los detalles de implementación son del programador; si se aparta
  de este documento, lo anota en el registro de cambios del final.
- Seguir las fases en orden y parar al final de cada una.
- Módulos puros primero y con pruebas antes de montar la interfaz encima.
- No hacer commits hasta que Pablo lo pida. El primer despliegue y cualquier cosa que salga hacia fuera, con su
  permiso.
- Para el aspecto visual, usar la skill `frontend-design`. Móvil primero en el escaneo; ordenador primero en la
  edición.
- Al cerrar el proyecto o una fase grande, la documentación que pide el `CLAUDE.md` global de Pablo.

## 15. Puntos abiertos

Con el valor que se usa mientras Pablo no diga otra cosa:

1. Acceso con correo y contraseña creados por Pablo (§2).
2. Nombre de la aplicación: «Exámenes Test QR» de forma provisional.

Resueltos: la fórmula de la puntuación parcial la elige la profesora en la app (§9); el móvil de la profesora es un Android como el de pruebas, así que basta con Chrome en Android; los
modelos barajados van en la fase 3, los primeros.

## Registro de cambios

- 11/11/2026: versión inicial.
- 11/11/2026: modelos A a D con un PDF y un QR por modelo; criterio por pregunta cuando hay varias correctas
  (`cualquiera` por defecto); opción de no barajar las opciones de una pregunta; aclarado qué lleva el QR.
- 11/11/2026: navegadores admitidos (Edge, Chrome y Firefox en portátil, Chrome en Android); aclarado que una sola
  captura lee toda la hoja y que el orden de corrección da igual.
- 11/11/2026: Firefox en Android y aviso cuando el navegador no da acceso a la cámara; la fórmula de la puntuación
  parcial se elige en la app (`resta` o `anula`).
- 11/11/2026 (fase 0, programador): cambios respecto al §5 y al §7, todos validados con el banco sintético.
  - QR de 30 mm en lugar de 24 (módulos de 1,43 mm). Con 24 mm fallaba en un 10 % de las fotos de poca resolución.
    Además del lector normal, el QR se lee «por rejilla»: como la hoja ya está enderezada, se muestrea cada módulo
    en su sitio, ajustado a los tres cuadros de posición del QR. Sigue siendo un QR estándar.
  - Marcadores de 14 mm (diccionario ARUCO_MIP_36h12, ids 0–3), a 10 mm del borde. Se aceptan como máximo 3 bits
    erróneos. El código de detección de `js-aruco2` (MIT) está copiado como ESM en `src/scanner/vendor/aruco`,
    porque el paquete depende del `this` global de CommonJS.
  - Esquinas de los marcadores afinadas al subpíxel sobre la foto completa.
  - Área de respuestas desde y = 45 mm (por debajo del margen del QR). El bloque de identificación mide al menos
    el ancho de una columna, para aprovechar la columna corta que queda debajo.
  - Capacidad real por hoja (DNI de 8 cifras / 5 cifras): 2 opciones 212/191, 3 → 157, 4 → 123, 5 → 89/123,
    6 → 89.
  - Umbrales de burbuja: relleno ≥ 0,50 marcada, ≤ 0,08 vacía, en medio dudosa (sobre el disco interior de 1,55 mm
    de radio, restado el nivel de las vacías de la hoja). Pendiente de recalibrar con fotos reales.
  - Red de seguridad añadida al §7: tras medir, se busca el contorno impreso de todas las burbujas vacías en
    ±2,6 mm. Si en una zona de 30 mm al menos 4 burbujas y la mitad aparecen a más de 1 mm de donde se midió, la
    hoja se rechaza («repite la foto»). Con desplazamientos forzados de hasta 1,5 mm la hoja se lee bien; desde
    2 mm se rechaza.

## Estado de la fase 0 (11/11/2026, en curso)

Hecho:

- Geometría (`src/shared/sheet`), formato del QR, reglas de dudas, PDF de la hoja de respuestas (`src/pdf`).
- Escáner completo (`src/scanner`): marcadores, homografía, rectificado, luz, QR, burbujas, calidad y red de
  seguridad. Unos 0,2 s por foto en el ordenador (de 1080p a 12 MP).
- Banco sintético (`npm run bench:escaner`): 600 casos sin errores silenciosos, ninguna marca de bolígrafo a duda,
  un 1–1,5 % de hojas sin leer (lejos, tapadas o muy desenfocadas), siempre con mensaje.
- Hojas de prueba con plan de relleno (`src/shared/demo.ts`, `src/pdf/demo-pdf.ts`) y comparación con el plan.

Pendiente:

- Prueba que genera el PDF real, lo rasteriza con `mupdf` y lo escanea.
- Página mínima (React) con descarga de las hojas de prueba, cámara con disparo automático, «subir foto» y la
  lectura superpuesta comparada con el plan; escáner en un Web Worker.
- `npm run fotos:escaner` para las fotos reales de `tests/fixtures/fotos/`.
- Despliegue (necesita que Pablo haga `npx wrangler login` con su cuenta personal) o prueba en red local con
  `npm run dev:movil`.
- Fotos reales de Pablo y recalibrado; medir el tiempo en el Realme.
