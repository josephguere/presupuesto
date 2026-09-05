# Presupuesto

Aplicación web personal de presupuesto. Cuando llega un correo de consumo del
BCP a Gmail, la transacción aparece sola en el dashboard.

---

## 1. Arquitectura

```
Gmail
  │  correo de consumo del BCP
  ▼
Google Apps Script          ← trigger temporal cada 1 minuto
  │  detecta · lee · envía   (NO interpreta nada)
  ▼
POST /api/ingest/bcp        ← cabecera x-ingest-key
  │  valida · parsea · deduplica
  ▼
Supabase PostgreSQL
  │  email_ingestions  +  transactions
  ▼
Dashboard Next.js           ← Server Components
```

**Por qué el parser vive en Next.js y no en Apps Script.** Apps Script solo
detecta, lee y envía. La lógica de negocio está en el repositorio, con tipos y
pruebas: corregir el parser es desplegar la web, no volver a tocar Apps Script.

**Por qué se separan el correo y la transacción.** `email_ingestions` guarda el
correo crudo siempre, incluso si el parser falla. Un cambio de formato del banco
nunca implica perder datos: se corrige el parser y se reprocesa desde la base de
datos.

**Cómo se evitan los duplicados.** Tres capas independientes:

| Capa | Mecanismo | Qué evita |
|---|---|---|
| Gmail | etiqueta `BCP-Ingestado` | reenviar el mismo correo cada minuto |
| API | `upsert` sobre `gmail_message_id` | crear dos filas para un correo |
| PostgreSQL | `UNIQUE` en `gmail_message_id` y en `email_ingestion_id` | duplicados aunque falle todo lo demás |

La garantía real es la tercera: la base de datos, no la aplicación.

### Estructura

```
presupuesto/
├── app/
│   ├── layout.tsx                     Layout, navegación, tema
│   ├── page.tsx                       Dashboard: resumen del mes
│   ├── movimientos/page.tsx           Listado completo con filtros
│   ├── eliminados/page.tsx            Papelera: bajas lógicas y restaurar
│   ├── login/page.tsx                 Pantalla de acceso por PIN
│   ├── actions.ts                     Crear, editar, eliminar, restaurar
│   ├── api/ai/chat/route.ts           Chat: pregunta → intención → datos
│   ├── api/auth/login/route.ts        Canjea el PIN por una sesión
│   └── api/auth/logout/route.ts       Borra la cookie
│   └── api/ingest/bcp/
│       ├── route.ts                   POST de ingesta + GET de salud
│       └── route.test.ts              Tests de idempotencia y seguridad
├── components/
│   ├── SummaryCards.tsx               Indicadores del período
│   ├── TotalsPivot.tsx                Totales en 3 niveles, plegables
│   ├── MovementSortControl.tsx        Selector de orden, solo móvil
│   ├── FiltersBar.tsx                 Mes, rango, categoría y grupo
│   ├── MovementForm.tsx               Formulario de crear y editar
│   ├── MovementDialog.tsx             Modal que envuelve al formulario
│   ├── DeleteMovementButton.tsx       Baja lógica, con confirmación
│   ├── RestoreMovementButton.tsx      Restaurar, con confirmación
│   ├── AppHeader.tsx                  Navegación y cerrar sesión
│   ├── chat/
│   │   ├── ChatLauncher.tsx           Botón flotante y estado del chat
│   │   ├── ChatPanel.tsx              Carcasa: cabecera, lista, compositor
│   │   ├── ChatMessageList.tsx        Scroll y región viva
│   │   ├── ChatMessage.tsx            Burbuja y tabla de resultados
│   │   ├── ChatComposer.tsx           Cuadro de escribir
│   │   └── ChatBoundary.tsx           Aísla un fallo del chat de la página
│   ├── PinForm.tsx                    Las 4 casillas del PIN
│   ├── TransactionsTable.tsx          Tarjetas en móvil, tabla en escritorio
│   └── SetupNotice.tsx                Aviso si falta configuración
├── lib/
│   ├── format.ts                      Intl es-PE / America/Lima
│   ├── period.ts                      Períodos en hora de Lima (puro)
│   ├── ai/                            Chat: SOLO servidor
│   │   ├── limits.ts                  Números y textos visibles
│   │   ├── config.ts                  ¿Hay clave de Gemini?
│   │   ├── catalog.ts                 Catálogo vigente desde Supabase
│   │   ├── intent.ts                  Esquema y validación de la intención
│   │   ├── execute.ts                 Las 12 intenciones → consultas
│   │   ├── result.ts                  Qué puede salir, y qué no
│   │   ├── present.ts                 Cadenas al modelo, números al navegador
│   │   ├── prompts.ts                 Los dos prompts
│   │   ├── gemini.ts                  Las dos llamadas al SDK
│   │   ├── answer.ts                  Red anti-cifras inventadas
│   │   ├── deadline.ts                Presupuesto de tiempo
│   │   ├── errors.ts                  Toda la cadena de errores
│   │   └── rateLimit.ts               Límite por minuto y por día
│   ├── chat/                          Chat: lo que toca el navegador
│   │   ├── types.ts                   Contrato servidor ↔ interfaz
│   │   ├── state.ts                   Reducer de la conversación
│   │   └── client.ts                  Transporte a /api/ai/chat
│   ├── categories.ts                  Catálogo: categoría → resumen → grupo
│   ├── totals.ts                      Agregación de la tabla dinámica
│   ├── movementSort.ts                Orden de la lista de movimientos
│   ├── environment.ts                 Corte entre datos de prueba y reales
│   ├── logger.ts                      Logs estructurados, sin secretos
│   ├── transactions.ts                Lectura de movimientos y resumen
│   ├── movementSchema.ts              Validación compartida del formulario
│   ├── exchangeRate.ts                Tipo de cambio USD→PEN con caché
│   ├── auth/pin.ts                    Hash y verificación del PIN (scrypt)
│   ├── auth/session.ts                Cookie firmada (HMAC, Web Crypto)
│   ├── auth/lockout.ts                Freno de fuerza bruta
│   └── auth/guard.ts                  Sesión en páginas y Server Actions
│   ├── ingest/security.ts             Clave, remitente, filtro de asunto
│   ├── parsers/
│   │   ├── types.ts                   Contrato común de los parsers
│   │   ├── normalize.ts               Texto, montos y fechas en español
│   │   ├── bcpConsumo.ts              Consumos con tarjeta (débito y crédito)
│   │   ├── bcpPagoServicio.ts         Pagos de servicios (luz, telefonía...)
│   │   ├── bcpTransferencia.ts        Transferencias a otros bancos
│   │   └── bcp.ts                     Punto de entrada: despacha al parser
│   └── supabase/
│       ├── client.ts                  Fábrica compartida (sin secretos)
│       └── server.ts                  Cliente service-role, solo servidor
├── types/transaction.ts               Tipos de dominio y filas de BD
├── proxy.ts                           Puerta de entrada: exige sesión
├── sql/init.sql                       Esquema completo
├── google-apps-script/gmail-bcp.gs    Script de Gmail
├── scripts/
│   ├── db-init.ts                     Aplicar y verificar el esquema
│   ├── db-clear.ts                    Vaciar datos de prueba o reales
│   ├── auth-hash.ts                   Generar AUTH_PIN_HASH
│   ├── loadEnv.ts                     Cargar .env.local en los scripts
│   ├── parse-sample.ts                Probar el parser sin Gmail
│   └── post-sample.ts                 Probar el endpoint sin Gmail
└── samples/                           Correos de ejemplo
    ├── bcp-consumo.txt                formato con dos puntos
    ├── bcp-consumo-credito.txt        formato real del BCP
    ├── bcp-consumo-plaza-vea.txt      millares y hora AM
    ├── bcp-consumo-html.txt           HTML→texto con caracteres invisibles
    ├── bcp-pago-servicio.txt          pago de recibo (tabuladores)
    ├── bcp-pago-servicio-entel.txt    segundo pago de la misma compañía
    └── bcp-transferencia.txt          transferencia con DOS tarjetas
```

### Extensibilidad

Los parsers están organizados por banco y producto, no por una función genérica:

```
lib/parsers/
├── normalize.ts    ← compartido: texto, montos, fechas en español
├── bcpConsumo.ts   ← implementado: consumos BCP, débito y crédito
├── bcp.ts          ← enruta los correos del BCP a su parser
├── bcpTransfer.ts  ← futuro
├── interbank.ts    ← futuro
└── bbva.ts         ← futuro
```

Añadir un banco es: escribir su parser contra el mismo contrato `ParseResult`,
reutilizando `normalize.ts`, y añadir su ruta de ingesta. Ni el esquema de la
base de datos ni la interfaz cambian.

---

## 2. Requisitos

- Node.js 18.18 o superior (probado con 24.19)
- npm
- Una cuenta de Supabase (plan gratuito)
- Una cuenta de Google con Gmail
- Una cuenta de Vercel (plan gratuito) para publicarlo

---

## 3. Instalación local

```bash
npm install
```

---

## 4. Crear el proyecto en Supabase

1. Entra en <https://supabase.com> → **New project**.
2. Ponle un nombre (p. ej. `presupuesto`) y elige una contraseña de base de datos.
3. Elige la región más cercana (`South America (São Paulo)` desde Perú).
4. Espera a que termine el aprovisionamiento (1-2 minutos).

---

## 5. Crear el esquema

Dos vías equivalentes. El SQL es idempotente: ejecutarlo dos veces no rompe nada.

### Opción A — SQL Editor (sin instalar nada)

1. En tu proyecto de Supabase: **SQL Editor** → **New query**.
2. Pega el contenido íntegro de [`sql/init.sql`](sql/init.sql).
3. Pulsa **Run**.

### Opción B — desde la terminal

Aplica el mismo archivo y además **verifica** que todo quedó creado:

```bash
npm run db:init     # aplica sql/init.sql y comprueba el resultado
npm run db:check    # solo comprueba, no toca nada
```

Necesita `SUPABASE_DB_URL` en `.env.local`. Para obtenerla: en Supabase, botón
**Connect** (arriba) → pestaña **Session pooler** → copia el URI y sustituye
`[YOUR-PASSWORD]` por la contraseña de tu base de datos.

> Usa el **Session pooler**, no el Transaction pooler: el de transacciones
> (puerto 6543) no es adecuado para DDL. La conexión directa también sirve, pero
> en proyectos nuevos solo responde por IPv6 y muchas redes domésticas no lo
> tienen.
>
> `SUPABASE_DB_URL` es solo para estos scripts. **No la configures en Vercel**:
> la aplicación en runtime habla siempre por `@supabase/supabase-js`.

Salida esperada:

```
Tablas
  OK   email_ingestions
  OK   transactions
Restricciones
  OK   email_ingestions_gmail_message_id_key
  OK   email_ingestions_processing_status_check
  OK   transactions_email_ingestion_id_key
  OK   transactions_email_ingestion_id_fkey
Índices
  OK   transactions_transaction_at_idx
  ...
Row Level Security
  OK   email_ingestions
  OK   transactions

Esquema correcto. Ya puedes lanzar la ingesta.
```

En ambos casos se crean las tablas `email_ingestions` y `transactions`, la clave
foránea, las dos restricciones `UNIQUE`, los índices, el trigger de `updated_at`
y se activa Row Level Security.

> **Sobre RLS:** se activa sin crear ninguna policy. La `service_role` key
> (backend) la bypassea y lee todo; cualquier otra key no ve nada. Los datos
> quedan cerrados por defecto aunque se filtre la URL del proyecto.

---

## 6. Variables de entorno

Copia la plantilla y rellénala:

```bash
cp .env.example .env.local
```

| Variable | Dónde se obtiene | Secreta |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → *Project URL* | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → *service_role* | **Sí** |
| `GMAIL_INGEST_KEY` | La generas tú (ver abajo) | **Sí** |

Genera la clave de ingesta:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Opcionales, con valores por defecto sensatos:

| Variable | Por defecto | Para qué |
|---|---|---|
| `BCP_ALLOWED_SENDERS` | `notificaciones@notificacionesbcp.com.pe` | Aceptar más remitentes, separados por coma |
| `BCP_SUBJECT_FILTER` | *(vacío = sin filtro)* | Filtrar también por asunto |

> **No hace falta anon key.** El dashboard son Server Components que leen desde
> el servidor y Apps Script habla con nuestra API, no con Supabase. Añadirla
> obligaría a diseñar policies de RLS públicas sin aportar nada.

> **`SUPABASE_SERVICE_ROLE_KEY` nunca lleva el prefijo `NEXT_PUBLIC_`.** Ese
> prefijo hace que Next.js inline el valor en el bundle del navegador.

---

## 7. Ejecutar en local

```bash
npm install
npm run dev
```

- Dashboard: <http://localhost:3000>
- Movimientos: <http://localhost:3000/movimientos>
- Eliminados: <http://localhost:3000/eliminados>

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm run lint` | ESLint |
| `npm test` | Tests del parser y del endpoint |
| `npm run test:watch` | Tests en modo watch |
| `npm run build` | Build de producción |
| `npm run db:init` | Aplica `sql/init.sql` y verifica el esquema |
| `npm run db:check` | Solo verifica el esquema |
| `npm run db:clear` | Simulacro: qué movimientos se borrarían |
| `npm run db:clear -- --confirm` | Vacía los movimientos **reales** (producción) |
| `npm run parse:sample` | Prueba el parser con un `.txt` |
| `npm run post:sample` | Envía un correo falso al endpoint |

---

## 8. Configurar Google Apps Script

1. Ve a <https://script.google.com> → **Nuevo proyecto**.
2. Ponle nombre, p. ej. `Ingesta BCP`.
3. Borra el contenido de `Código.gs` y pega
   [`google-apps-script/gmail-bcp.gs`](google-apps-script/gmail-bcp.gs) entero.
4. Guarda (Ctrl+S).

---

## 9. Configurar las Script Properties

En el editor de Apps Script: **⚙ Configuración del proyecto** →
**Propiedades del script** → **Añadir propiedad de script**.

| Propiedad | Valor |
|---|---|
| `API_URL` | `https://tu-app.vercel.app/api/ingest/bcp` |
| `INGEST_KEY` | El mismo valor que `GMAIL_INGEST_KEY` en Vercel |

Opcionales:

| Propiedad | Por defecto | Para qué |
|---|---|---|
| `GMAIL_QUERY` | `from:notificaciones@notificacionesbcp.com.pe "Realizaste un consumo" newer_than:2d` | Ajustar la búsqueda |
| `PROCESSED_LABEL` | `BCP-Ingestado` | Nombre de la etiqueta |
| `VERCEL_BYPASS` | *(vacío)* | Saltarse la Deployment Protection de Vercel |

**Sobre `VERCEL_BYPASS`.** Vercel protege los despliegues con un login propio. Si
la dejas activa, tu dashboard solo lo ves tú —lo cual es deseable, porque el MVP
no tiene autenticación propia— pero Apps Script recibiría un redirect 302 en
lugar de tu API.

La solución: Vercel → Settings → **Deployment Protection** → **Protection Bypass
for Automation** → genera el secreto y ponlo en esta propiedad. El script lo
envía en la cabecera `x-vercel-protection-bypass` y pasa, mientras el dashboard
sigue protegido.

La alternativa es desactivar la protección, pero entonces cualquiera con la URL
ve tus gastos.

Las claves van aquí, **nunca escritas en el código**: cualquiera con acceso al
proyecto vería el archivo.

Después, verifica la configuración sin enviar ningún correo:

1. Selecciona la función `testConnection` en el desplegable → **Ejecutar**.
2. Google pedirá autorización: **Revisar permisos** → tu cuenta →
   *Configuración avanzada* → *Ir a (no seguro)* → **Permitir**.
   (Sale ese aviso porque el script es tuyo y no está verificado por Google.)
3. En **Registro de ejecución** debe aparecer `HTTP 200` y `Conexión correcta`.
   - `401` → `INGEST_KEY` no coincide con `GMAIL_INGEST_KEY`.
   - `404` → revisa `API_URL`.

Funciones auxiliares que puedes ejecutar a mano:

| Función | Para qué |
|---|---|
| `testConnection` | Comprueba `API_URL` e `INGEST_KEY` |
| `previewSearch` | Muestra qué correos encontraría, sin enviar nada |
| `dumpLatestEmailBody` | Vuelca el texto plano real de un correo del BCP |
| `ingestBcpEmails` | Ejecuta la ingesta una vez, a mano |
| `forgetSentIds` | Olvida qué se envió ya, para reprocesar todo |
| `removeTrigger` | Para la ingesta |

---

## 10. Crear el trigger de 1 minuto

En el editor de Apps Script, selecciona la función **`setup`** → **Ejecutar**.

Crea un trigger temporal que ejecuta `ingestBcpEmails` cada minuto. Ejecutar
`setup` dos veces no duplica el trigger: borra antes los anteriores.

Compruébalo en **⏱ Activadores** (menú izquierdo).

> Un minuto es para la POC. Cuando funcione, bájalo a 5-15 minutos: Apps Script
> tiene cuota diaria de tiempo de ejecución.

Para pararlo: ejecuta `removeTrigger`, o borra el activador desde ⏱.

---

## 10.5. Recuperar correos antiguos (backfill)

El trigger solo mira los ultimos dos dias. Para traer correos anteriores —los de
un mes que ya paso, o los de los dias en que el script estuvo parado— el propio
Apps Script trae dos funciones.

**1.** En el editor, edita las dos constantes de arriba del archivo:

```js
var BACKFILL_FROM = '2026/08/01';   // inclusive
var BACKFILL_TO   = '2026/08/29';   // inclusive
```

**2.** Ejecuta `previewBackfill`. No envia nada; solo cuenta:

```
2026/08/01: 2 hilos - 3 correos del BCP - 3 sin enviar todavia
...
TOTAL: 41 hilos - 96 correos del BCP - 88 sin enviar todavia
```

**3.** Ejecuta `backfillBcpEmails`.

### Por que va dia a dia

`GmailApp.search` devuelve como mucho 25 hilos, y siempre desde el principio de
la busqueda. Con una sola consulta de un mes entero, todo lo que pasara de 25
hilos quedaria fuera para siempre: repetir la ejecucion volveria a encontrar los
mismos de arriba y no avanzaria. Troceando por dias, cada consulta es pequena y
ese tope deja de importar.

### No duplica nada

Puedes ejecutarlo las veces que quieras sobre el mismo rango. Hay tres capas:

1. El cache `SENT_MESSAGE_IDS` se salta lo ya enviado.
2. La API responde `ALREADY_PROCESSED` si el correo ya estaba.
3. `gmail_message_id UNIQUE` en PostgreSQL: la garantia final.

### Si se corta por tiempo

Apps Script mata las ejecuciones a los 6 minutos. El backfill para solo a los
4,5 y te dice por donde seguir:

```
PARADA POR TIEMPO. Cambia BACKFILL_FROM a 2026/08/17 y vuelve a ejecutar.
```

Los IDs se guardan dia a dia, asi que nada se reenvia al retomar.

> El rango esta limitado a 92 dias (`BACKFILL_MAX_DAYS`) para que un dedazo en el
> ano no lance miles de busquedas contra Gmail.

---

## 11. Desplegar en Vercel

1. Sube el repositorio a GitHub.
2. <https://vercel.com> → **Add New** → **Project** → importa el repositorio.
3. Framework: **Next.js** (se detecta solo). No cambies nada más.
4. Añade las variables de entorno (paso 12) **antes** del primer despliegue.
5. **Deploy**.

Anota la URL, p. ej. `https://presupuesto-tuusuario.vercel.app`.

---

## 12. Configurar las variables en Vercel

**Project** → **Settings** → **Environment Variables**. Añade las cinco para los
entornos *Production*, *Preview* y *Development*:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | La URL de tu proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | La service_role key |
| `GMAIL_INGEST_KEY` | La misma clave que en Apps Script |
| `AUTH_PIN_HASH` | Lo que imprime `npm run auth:hash` |
| `AUTH_SESSION_SECRET` | 64 caracteres hexadecimales aleatorios |
| `GEMINI_API_KEY` | Opcional. De <https://aistudio.google.com/apikey>. Sin ella no hay sugerencia de categoría por IA **ni chat** |

Las dos de `AUTH_` van marcadas como **Sensitive** si Vercel lo ofrece: así el
valor deja de poder leerse desde el panel una vez guardado.

> Sin `AUTH_PIN_HASH` y `AUTH_SESSION_SECRET`, la aplicación desplegada muestra
> la pantalla de acceso con un aviso de configuración y no deja entrar a nadie.
> Es lo correcto: preferimos una aplicación cerrada a una abierta por descuido.

Si las añades después del primer despliegue, hay que **redesplegar** para que se
apliquen: **Deployments** → *⋯* → **Redeploy**.

Por último, actualiza `API_URL` en las Script Properties con la URL real.

---

## 13. Probar el endpoint manualmente

Con `npm run dev` levantado en otra terminal:

```bash
npm run post:sample
```

Ejecútalo **dos veces**: la primera responde `PROCESSED` y la segunda
`ALREADY_PROCESSED`, sin crear una segunda fila. Esa es la prueba de idempotencia.

```bash
npm run post:sample -- --id fake-msg-002                        # otro mensaje
npm run post:sample -- --url https://tu-app.vercel.app/api/ingest/bcp
```

### Con curl

```bash
curl -i -X POST http://localhost:3000/api/ingest/bcp \
  -H "Content-Type: application/json" \
  -H "x-ingest-key: TU_GMAIL_INGEST_KEY" \
  -d '{
    "gmailMessageId": "prueba-001",
    "gmailThreadId": "hilo-001",
    "from": "Banco de Credito BCP <notificaciones@notificacionesbcp.com.pe>",
    "to": "tu-correo@gmail.com",
    "subject": "Consumo con Tarjeta de Debito BCP",
    "receivedAt": "2026-08-26T23:28:00.000Z",
    "rawBody": "Realizaste un consumo de S/ 20.00 con tu\nTarjeta de Débito BCP en YAPE.\n\nDatos de la operación:\n\nTotal del consumo:\nS/ 20.00\n\nOperación realizada:\nConsumo Tarjeta de Débito\n\nFecha y hora:\n26 de agosto de 2026 - 06:28 PM\n\nNúmero de Tarjeta de Débito:\n************3400\n\nEmpresa:\nYAPE\n\nNúmero de operación:\n539458"
  }'
```

Respuesta esperada la primera vez:

```json
{ "ok": true, "status": "PROCESSED", "emailId": "...", "transactionId": "..." }
```

Y la segunda:

```json
{ "ok": true, "status": "ALREADY_PROCESSED", "emailId": "...", "transactionId": "..." }
```

Comprobación de salud (no toca la base de datos):

```bash
curl http://localhost:3000/api/ingest/bcp -H "x-ingest-key: TU_GMAIL_INGEST_KEY"
```

### Respuestas del endpoint

| HTTP | `status` | Significado | ¿Apps Script reintenta? |
|---|---|---|---|
| 200 | `PROCESSED` | Guardado y parseado | No |
| 200 | `ALREADY_PROCESSED` | Ya existía, sin duplicar | No |
| 200 | `PARSE_ERROR` | Correo guardado, formato no reconocido | No |
| 400 | `INVALID_JSON` / `INVALID_PAYLOAD` | Petición mal formada | No |
| 401 | `UNAUTHORIZED` | `x-ingest-key` ausente o incorrecta | Sí |
| 403 | `SENDER_NOT_ALLOWED` | Remitente no permitido | Sí |
| 500 | `SERVER_MISCONFIGURED` / `INTERNAL_ERROR` | Configuración o fallo transitorio | Sí |

`PARSE_ERROR` devuelve **200 a propósito**: el correo ya está guardado y
reintentar no cambiaría nada. Se arregla corrigiendo el parser y reprocesando.

---

## 14. Probar el parser sin Gmail

```bash
npm test                                          # 83 tests
npm run parse:sample                              # samples/bcp-consumo.txt
npm run parse:sample -- ruta/a/tu-correo.txt      # tu propio correo
```

### Conseguir una muestra real de tu correo

El parser está escrito contra el correo de ejemplo del enunciado. Para validarlo
con uno de verdad, hay dos formas de obtener el texto plano exacto:

**A. Desde Apps Script** *(recomendada: es literalmente lo que envía el script)*

1. Ejecuta la función `dumpLatestEmailBody`.
2. Copia lo que hay entre `----- INICIO DEL TEXTO PLANO -----` y `----- FIN -----`.
3. Guárdalo como `samples/mi-correo.txt`.
4. `npm run parse:sample -- samples/mi-correo.txt`

**B. Desde Gmail**

Abre el correo → **⋮** → **Mostrar original** → copia la parte `text/plain`.

Si el parser falla con tu correo real, el mensaje dice qué campos faltan.
Añade las variantes de etiqueta que veas a las listas de `bcpConsumo.ts` — están
pensadas para eso — y añade el caso a `bcpConsumo.test.ts`.

El parser soporta las dos disposiciones que usa el banco: `Etiqueta: valor` (con
dos puntos) y `Etiqueta *valor*` (sin dos puntos, valor en negrita, que es la
real). Además, cada campo obligatorio tiene un regex de respaldo sobre el cuerpo
entero, por si el formato vuelve a cambiar.

---

## 15. Troubleshooting

**El dashboard muestra «No se pudo cargar la información».**
Faltan variables de entorno o no se ejecutó `sql/init.sql`. El aviso dice qué
variable falta. En local, reinicia `npm run dev` tras editar `.env.local`.

**Apps Script devuelve 401.**
`INGEST_KEY` (Script Properties) y `GMAIL_INGEST_KEY` (Vercel) no coinciden.
Cuidado con espacios al copiar. Si cambiaste la variable en Vercel, redespliega.

**Apps Script devuelve 404.**
`API_URL` mal. Debe terminar en `/api/ingest/bcp`, sin barra final.

**Apps Script devuelve 302 o 307, o `curl` responde «Redirecting...».**
Deployment Protection de Vercel. Configura `VERCEL_BYPASS` (ver arriba) o
desactívala en Settings → Deployment Protection.

**Funcionaba y de pronto da 404.**
Seguramente copiaste en `API_URL` la URL con hash del despliegue
(`presupuesto-k3j9x2mq1.vercel.app`), que cambia en cada `git push`. Usa el
dominio corto de **Production**, sin hash.

**Apps Script devuelve 403 `SENDER_NOT_ALLOWED`.**
El BCP escribe desde otra dirección. Míralo con `previewSearch` y añádela a
`BCP_ALLOWED_SENDERS` (separadas por coma).

**El correo llega pero responde `PARSE_ERROR`.**
El formato no coincide. Consulta `processing_error` en `email_ingestions`:

```sql
select gmail_message_id, processing_error, left(raw_body, 400)
from email_ingestions
where processing_status = 'PARSE_ERROR'
order by created_at desc;
```

Copia ese `raw_body` a un `.txt`, reprodúcelo con `npm run parse:sample`,
corrige el parser, añade el test y redespliega.

**Reprocesar correos que fallaron.** Corrige el parser, redespliega, y ejecuta
**`forgetSentIds`** en Apps Script. El siguiente disparo reenvía todo lo que
encuentre la búsqueda y el endpoint reprocesa sobre la fila existente, sin
duplicar. La etiqueta `BCP-Ingestado` es solo una marca visual: quitarla no
cambia nada.

**Apps Script no encuentra nada.**
Ejecuta `previewSearch`. Si sale 0, relaja `GMAIL_QUERY`: `newer_than:2d` deja
fuera los correos más antiguos.

**No es tiempo real.** El trigger sondea cada minuto, así que un consumo tarda
entre 0 y ~60 s en aparecer (más lo que Gmail tarde en entregar el correo).
`newer_than:2d` es además la ventana de recuperación: si la app estuviera caída,
los correos se reintentan mientras sigan dentro de esa ventana. Si prevés una
caída larga, amplíala a `newer_than:7d`.

**Movimientos duplicados en el dashboard.**
No debería ocurrir: hay `UNIQUE` en `gmail_message_id`. Si pasa, comprueba que
`sql/init.sql` se ejecutó entero:

```sql
select gmail_message_id, count(*)
from email_ingestions
group by gmail_message_id having count(*) > 1;
```

**La fecha o la hora no cuadran.**
Todo se guarda con offset `-05:00` y se muestra en `America/Lima`. Perú no tiene
horario de verano. Verifica con:

```sql
select transaction_at, transaction_at at time zone 'America/Lima' from transactions;
```

**El build falla en Vercel por variables de entorno.**
No debería: los clientes de Supabase se crean de forma perezosa y las páginas son
dinámicas. Si ocurre, revisa el log de build; el error nombra la variable.

---

---

## Datos de prueba vs. datos reales

Local y producción **comparten la misma base de datos** de Supabase. Sin nada que
los separe, los movimientos que creas con `npm run post:sample` aparecerían en el
dashboard público mezclados con tus consumos de verdad, falseando los totales.

Cada fila lleva por eso un `is_test`, y quien lo decide es el **entorno donde se
ingirió el correo**, nunca el payload:

| Origen | Entorno | `is_test` | ¿Se ve en producción? |
|---|---|---|---|
| `npm run post:sample` | localhost (`next dev`) | `true` | No |
| Google Apps Script | Vercel | `false` | Sí |

Que lo decida el servidor y no un campo del JSON es deliberado: nadie puede
marcar datos como reales —ni como falsos— desde fuera. El schema es `strict()`,
así que un payload que intente colar `is_test` recibe un 400.

El dashboard filtra `is_test = false` solo en producción; en local los ves todos.
Misma base de datos, dos vistas. Ver `lib/environment.ts`.

**Para comprobarlo:**

```bash
npm run dev                      # localhost:3000 → todos los movimientos
npm run build && npm start       # localhost:3000 → solo los reales
```

---

---

## Añadir tablas o columnas

**No hay que tocar nada a mano en Supabase.** El flujo es siempre el mismo:

1. Edita `sql/init.sql`.
2. Añade lo nuevo a `EXPECTED` en `scripts/db-init.ts`.
3. Actualiza `types/transaction.ts`.
4. `npm run db:init`.

Ese es el orden. El paso 2 es el que se olvida y el que más duele: la lista de
`EXPECTED` se mantiene **a mano** a propósito, porque si se generase leyendo la
base de datos no podria detectar que falta algo. Sin ese paso, `db:check` dira
«esquema correcto» aunque la migracion se haya quedado a medias.

### Regla de oro: todo idempotente

`sql/init.sql` se ejecuta entero cada vez. Nada debe romperse ni duplicarse al
repetirlo.

**Tabla nueva**

```sql
create table if not exists public.presupuestos (
  id         uuid primary key default gen_random_uuid(),
  categoria  text not null,
  limite     numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NO OLVIDES ESTO. Sin RLS, la tabla queda abierta a cualquiera con la anon key.
alter table public.presupuestos enable row level security;

drop trigger if exists set_updated_at on public.presupuestos;
create trigger set_updated_at
  before update on public.presupuestos
  for each row execute function public.set_updated_at();
```

**Columna nueva, sin datos que rellenar**

```sql
alter table public.transactions
  add column if not exists notas text;
```

**Columna nueva CON relleno de datos** — aquí `if not exists` no basta, porque el
`update` volvería a ejecutarse cada vez y machacaría cambios posteriores. Se
envuelve en un bloque que solo actúa la primera vez:

```sql
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'transactions'
       and column_name  = 'category_confirmed_at'
  ) then
    alter table public.transactions add column category_confirmed_at timestamptz;

    -- Relleno UNICO: solo corre la primera vez.
    update public.transactions set category_confirmed_at = now() where category is not null;
  end if;
end $$;
```

Es exactamente el patrón que usa la migración de `is_test`.

### Orden al desplegar

Si el código nuevo necesita la columna nueva:

```bash
npm run db:init      # 1. primero la base de datos
git push             # 2. después el código
```

Al revés, producción quedaría pidiendo una columna que aún no existe. Local y
producción comparten la misma Supabase, así que `db:init` desde tu máquina ya
migra la base que usa Vercel — no hay un paso de migración en el despliegue.

### Qué NO es automático

| | |
|---|---|
| Crear la tabla / columna | ✅ `npm run db:init` |
| Verificar que quedó | ✅ `npm run db:check` |
| Tipos de TypeScript | ❌ a mano en `types/transaction.ts` |
| Lista de `EXPECTED` | ❌ a mano en `scripts/db-init.ts` |
| RLS en tablas nuevas | ❌ a mano en el SQL |
| Borrar columnas | ❌ a mano, y con cuidado |

Los tipos son manuales porque este MVP no usa generación de tipos de Supabase.
Si algún día son muchas tablas, `npx supabase gen types typescript` los genera.

---

## Categorías

Cada movimiento tiene un desplegable para asignarle categoría. Guarda solo con
cambiarlo: en una tabla de veinte filas, un botón «Guardar» por fila sería
insoportable. El valor se pinta de forma optimista y se revierte si el servidor
falla.

Las categorías son una **lista fija en TypeScript** (`lib/categories.ts`), no una
tabla. Con una docena de valores que casi nunca cambian, una tabla solo añadiría
un JOIN a cada consulta y una pantalla de mantenimiento que nadie usaría. En la
base de datos se guarda el texto en `transactions.category`; `NULL` es «sin
categoría».

### Seguridad de la Server Action

`updateTransactionCategory` es un **endpoint público** —eso es toda Server
Action— y escribe con la `service_role` key, que se salta el RLS. Por eso valida
contra un esquema cerrado antes de tocar nada:

- el id tiene que ser un UUID;
- la categoría, una de la lista. Nunca texto libre del cliente.

Lo peor que puede conseguir alguien es cambiar una categoría por otra válida.
Hay tests que lo comprueban con intentos de inyección y con ids inventados.

### Lo que viene después

Sugerir la categoría automáticamente a partir del comercio, con una tabla
`merchant_categories` que aprenda de tus correcciones. Ver la conversación de
diseño: reglas antes que IA, porque el gasto personal es muy repetitivo y una
sugerencia determinista da totales en los que se puede confiar.

---

## Empezar producción desde cero

Si quieres que el dashboard público nazca vacío y se llene solo con lo que traiga
Apps Script:

```bash
npm run db:clear                 # simulacro: enseña qué se borraría
npm run db:clear -- --confirm    # borra los movimientos reales
```

Tus muestras locales (`is_test = true`) se quedan. Otros ámbitos:

```bash
npm run db:clear -- --test --confirm   # borra solo las muestras locales
npm run db:clear -- --all --confirm    # borra todo
```

Sin `--confirm` nunca borra nada. Y siempre lista antes lo que va a borrar.

**Importante:** después de vaciar, ejecuta **`forgetSentIds()`** en Apps Script.
Si no, recuerda esos correos como ya enviados y no los reenviará.

---

---

## Qué correos del BCP se leen

Tres tipos, cada uno con su parser. `lib/parsers/bcp.ts` decide cuál usar según
la frase que aparece en el cuerpo; ninguna se solapa con otra.

| Correo | Frase que lo identifica | Movimiento | Importe |
|---|---|---|---|
| Consumo con tarjeta | «Realizaste un consumo» | `Empresa` | `Total del consumo` |
| Pago de servicios | «Pago de servicios» | `Empresa` | `Monto total` |
| Transferencia | «Realizaste una transferencia» | `Transferencia a <banco>` | `Total cobrado` |

Un parser por tipo, y no ramas dentro de uno, porque cada formato tiene sus
etiquetas y su propia idea de cuál es «el importe». Mezclarlos haría que un
cambio del banco en un formato pudiera romper los otros dos.

### Dos decisiones que no son obvias

**El importe del pago de servicios sale de `Monto total`, no de `Importe`.** Ese
último pertenece al bloque «Nº 1» de un recibo concreto: al pagar dos de una vez
aparece un «Nº 2» con el suyo, y leer esa etiqueta daría solo el primero.

**La transferencia trae DOS tarjetas.** `**** 7842` es la del destinatario, bajo
«Enviado a», y `**** 4035` la tuya, bajo «Desde». Se lee anclada a «Desde»;
buscar «el primer `****` del cuerpo» guardaría la cuenta ajena como si fuera la
tuya. Hay una prueba que lo fija.

### El comentario distingue lo que el nombre no

Dos recibos de la misma compañía se verían idénticos salvo por el importe, así
que el parser rellena el comentario con lo que los separa:

```
ENTEL PERU S.A.   S/ 74.90   PAGO CON NUMERO TELEFONO · 979336700
ENTEL PERU S.A.   S/ 59.90   PAGO CON NUMERO TELEFONO · 923703951
```

En las transferencias va el destinatario. Es un comentario normal: editable y
borrable como cualquier otro.

### Solo salidas

El BCP no notifica el dinero que entra, así que **todo correo ingerido es dinero
que sale**. No hay que deducir ningún signo, y un movimiento de origen `EMAIL`
en el grupo INGRESOS es siempre un error de clasificación.

### Añadir un tipo nuevo

1. Un parser en `lib/parsers/`, con su `is…Email()` y su `parse…Email()`.
2. Registrarlo en el array `PARSERS` de `lib/parsers/bcp.ts`.
3. Añadir la frase a `BCP_SEARCH_BASE` **y** a `BCP_BODY_MARKERS` en
   `google-apps-script/gmail-bcp.gs`. Si falta, el correo nunca sale de Gmail.
4. Una muestra en `samples/` y sus tests.

---

## Sugerencia de categoría

Al abrir **Editar** en un movimiento, la aplicación propone una categoría. Solo
propone: no escribe nada hasta que pulsas «Guardar cambios».

```
1. Tu propio historial     gratis, instantáneo
2. Gemini                  solo si el historial no alcanza
3. Nada                    eliges a mano, como siempre
```

El historial va primero por una razón que no es el coste: **nadie conoce tus
gastos mejor que tú**. Si ya categorizaste ese comercio, esa es la respuesta.

### Cómo se reconoce un comercio

El banco escribe el mismo sitio de muchas formas, así que hay **dos claves**:

| | «DLC*PedidosYa KFC Qhatu P» |
|---|---|
| Canónica | `PEDIDOSYA KFC QHATU P` |
| Familia | `PEDIDOSYA` |

Se buscan en cascada y **la canónica manda**. Si «Yape Movilidad» tiene su propio
historial decide él, en vez de diluirse en el cubo de todo lo que empieza por
YAPE, que está repartido entre cuatro categorías.

La pasarela de pago (`DLC*`, `EBN*`, `IZI*`, `EPC*`) se elimina y **nunca**
agrupa: es el procesador, no el negocio. Si agrupara, «DLC*Temucom» y
«DLC*UBER RIDES» caerían en el mismo saco.

Una coincidencia exacta decide con una sola fila —es tu decisión, no una
inferencia—, pero una familia tiene que estar acreditada: dos comercios
distintos, tres movimientos y 80 % de acuerdo. Empate o conflicto pasan a Gemini.

### Qué se le envía a Gemini, y qué no

Solo comercio, tipo, comentario depurado, importe y hasta diez ejemplos de cómo
clasificas tú. Nunca tarjeta, número de operación ni fechas.

Depurar el comentario **no es opcional**: el que rellena la ingesta contiene
cosas como `PAGO CON NUMERO TELEFONO · 979336700`. Omitir columnas no habría
bastado; el teléfono va dentro de un campo que sí queremos enviar.

**La defensa contra la inyección no es el prompt.** El nombre del comercio viene
de un correo, es decir, de fuera. La respuesta del modelo está restringida por
`responseSchema` a las categorías del catálogo, se revalida al recibirla, y el
grupo lo deriva el servidor. Lo peor que puede lograr una inyección es una
categoría válida pero equivocada, que ves antes de guardar.

### Sin clave sigue funcionando

Sin `GEMINI_API_KEY` no se llama a nada y la sugerencia usa solo tu historial. Si
Gemini falla, agota cuota o tarda más de 6 segundos, la respuesta es «sin
sugerencia» y eliges a mano. Nunca bloquea la edición.

> El modelo por defecto es `gemini-3.5-flash-lite`. El `2.5-flash-lite` ya no se
> sirve a claves nuevas. Se puede cambiar con `GEMINI_MODEL` sin desplegar.

---

## Chat: consultar tus datos

Un botón flotante abajo a la derecha, **Consultar mis datos**, abre un chat que
responde preguntas sobre tus movimientos:

```
¿Cuánto gasté este mes?
¿Cuál fue mi categoría con mayor gasto?
¿Cuánto gasté en FIBERPRO?
Compara mis gastos de agosto y septiembre
Mis cinco movimientos más altos
¿Y el mes anterior?
```

Lo que no trate de tu presupuesto se rechaza con una sola frase, siempre la
misma. No hay forma de sacarle un poema ni la capital de Francia.

### Gemini nunca toca la base de datos

Es lo que sostiene todo lo demás, así que conviene verlo entero:

```
Tu pregunta
     ↓
La API valida la SESIÓN                     ← sin cookie no se pasa de aquí
     ↓
Cuenta el mensaje en el LÍMITE de consumo   ← antes de gastar cuota
     ↓
Lee el CATÁLOGO vigente de Supabase         ← qué categorías existen hoy
     ↓
Gemini devuelve una INTENCIÓN estructurada  ← doce nombres y unos filtros
     ↓
El servidor la VALIDA                       ← aquí muere lo imposible
     ↓
El servidor CONSULTA Supabase               ← con la capa de solo lectura
     ↓
Gemini REDACTA con esos resultados          ← y solo con ellos
     ↓
Se comprueba que no inventó ninguna cifra
     ↓
Respuesta
```

**Gemini no genera SQL, no nombra tablas ni columnas y no puede escribir.** Su
primera respuesta está encerrada en un esquema que solo admite una de estas doce
intenciones:

```
total_expenses       total_income          balance          transaction_count
transaction_list     highest_transactions  category_total   category_breakdown
group_total          group_breakdown       merchant_total   period_comparison
```

y unos filtros cuyos valores salen de un `enum` con tu catálogo real. El
servidor traduce eso a `getTransactions`, la misma función de solo lectura que
alimenta la pantalla de Movimientos. Por eso el chat hereda gratis tres cosas:
**no ve los movimientos eliminados**, respeta el corte entre datos de prueba y
reales, y no tiene por dónde escribir.

Lo peor que puede conseguir una inyección —en tu pregunta o en el nombre de un
comercio que venga de un correo— es que se ejecute **otra de las doce consultas
de solo lectura sobre tus propios datos**. Verías un total real que no era el
que pedías.

### Qué sale y qué no

| Sale | No sale |
|---|---|
| Fecha, comercio, monto | Número de tarjeta |
| Categoría, resumen, grupo | Número de operación |
| Totales y recuentos ya calculados | Comentario completo del movimiento |
| El período aplicado | Identificadores internos, cuerpo del correo |

No es una promesa: los campos prohibidos **no existen en los tipos** que viajan
hacia el modelo ni hacia el navegador, y hay una prueba que revisa el JSON
completo del resultado buscándolos.

### Las cuentas las hace el servidor

Al modelo se le mandan los importes **ya escritos** (`S/ 1,286.20`), nunca
números sueltos. Si no recibe números, no puede sumarlos mal. Los totales, los
porcentajes y las comparaciones entre períodos se calculan en TypeScript antes
de llamarlo.

Y después se comprueba: si en su respuesta aparece una cifra que no estaba en
los datos que se le dieron, **se descarta su texto** y responde el servidor con
una frase construida a partir de los mismos hechos. Esa frase de respaldo hace
falta igual para cuando Gemini tarda de más o falla, así que verificar sale casi
gratis.

### Fechas

Entiende `hoy`, `ayer`, `esta semana`, `este mes`, `mes anterior`, `agosto`,
`septiembre de 2026`, `últimos 30 días` y rangos explícitos. Todo en
`America/Lima`, y **las fechas las calcula el servidor**: el modelo solo elige
la etiqueta. Pedirle que calcule «el mes pasado» sería confiarle saber qué día
es hoy y la aritmética de meses de 28, 30 y 31 días.

El mes en curso se corta **hoy**, no el día 30, y la respuesta lo dice:
«septiembre de 2026 (mes en curso, hasta el día 5)».

### El catálogo se lee de Supabase

Las categorías que el chat acepta salen de una consulta a tus movimientos
(`catalogo_categorias`), unidas con la jerarquía de `lib/categories.ts`, que es
el único sitio donde existe la relación categoría → resumen → grupo.

Es híbrido porque tiene que serlo: **no hay tabla de categorías**. Qué
categorías existen es un dato y se consulta; a qué grupo pertenecen no lo es y
se deriva del catálogo. La consecuencia práctica es que una categoría nueva
queda disponible sola por los dos caminos: si aparece en los datos, entra (sin
grupo, y el chat lo dice); si se añade a `lib/categories.ts`, entra con su grupo.

Además el emparejamiento perdona tildes, mayúsculas, plurales y una errata:
`delivery`, `Delivery` y `Supermercdo` encuentran lo que toca. Si un término
encaja con **varias** categorías no elige ninguna: pregunta cuál.

### Límites y errores

| | |
|---|---|
| Pregunta | entre 2 y 500 caracteres |
| Mensajes | 8 por minuto, 150 por día |
| Historial | 12 turnos en pantalla, 6 al modelo |
| Filas | 25 al modelo, 20 en la tabla |
| Tiempo | 10 s por llamada, 24 s la petición entera |

El límite se cuenta **en PostgreSQL**, no en memoria: Vercel es serverless y un
contador en una variable no se comparte entre instancias. Y **falla cerrado**:
si el contador no responde, no se llama a Gemini.

Si algo va mal el chat lo dice y la aplicación sigue funcionando. Un fallo de
render suyo tampoco se lleva la página por delante: está envuelto en un límite
de error que lo apaga y deja el resto intacto.

### El historial no se guarda

Vive en el estado del navegador y en ningún sitio más. **No se guarda en
Supabase ni en `localStorage`**: se borra al pulsar «Limpiar», al recargar y al
cerrar sesión. Cerrar el panel sí lo conserva, para poder volver.

Al modelo no se le reenvía el texto que él mismo escribió, sino una línea corta
del servidor (`total_expenses · agosto de 2026`). Es lo que hace que «¿y el mes
anterior?» funcione sin que el nombre de un comercio vuelva a entrar en el
siguiente prompt.

### Sin clave, no aparece

Sin `GEMINI_API_KEY` el botón flotante **no se pinta**. Aquí no se degrada como
en la sugerencia de categoría —que sigue funcionando con tu historial— porque no
hay nada a lo que degradar: sin modelo no se puede entender una pregunta escrita
en castellano.

> **Al desplegar esto hay que ejecutar `npm run db:init`.** Añade la tabla
> `rate_limits` y las funciones `register_rate_hit` y `catalogo_categorias`. El
> script es idempotente y no toca ningún dato. Sin ellas el chat responde error
> a todo, porque el límite falla cerrado.

---

## Acceso: PIN de 4 dígitos

La aplicación está cerrada. Al entrar sin sesión solo se ve `/login`: cuatro
casillas, el PIN y nada más. Ni usuario, ni correo, ni registro.

### Poner en marcha el acceso

```bash
npm run auth:hash
```

Pide el PIN por teclado **sin mostrarlo**, lo pide dos veces y escupe las dos
líneas que hay que copiar en `.env.local`:

```
AUTH_PIN_HASH=scrypt.16384.8.1.<sal>.<hash>
AUTH_SESSION_SECRET=<64 caracteres hexadecimales>
```

El PIN no se pasa por argumento a propósito: quedaría en el historial de la
terminal y en la lista de procesos. Y no se guarda en ningún archivo: lo único
que existe es el hash.

> **Sin estas dos variables no entra nadie**, ni siquiera en local. Es
> deliberado: una configuración a medias no puede dejar la aplicación abierta.
> La pantalla de acceso lo dice en vez de quedarse en silencio.

### Cómo está protegido

| Pieza | Cómo |
|---|---|
| El PIN | `scrypt` (en `node:crypto`, sin dependencias nuevas). Solo se guarda el hash, y solo en el servidor |
| La sesión | Cookie firmada con HMAC-SHA256. `HttpOnly`, `SameSite=Lax`, `Secure` en producción, 30 días |
| Las páginas | `proxy.ts` redirige a `/login` a quien no tenga sesión |
| Las Server Actions | Vuelven a comprobar la cookie **antes de escribir** |
| Los intentos | 5 fallos → 15 minutos de bloqueo, contados en Supabase |

**Por qué dos capas.** La documentación de Next dice que el proxy sirve para
comprobaciones optimistas, no como autorización. Y una Server Action es un
endpoint público: quien conozca su identificador la invoca sin pasar por ninguna
página. Por eso crear, editar, eliminar y restaurar verifican la sesión ellas
mismas, en el mismo proceso que hace el `UPDATE`. Ocultar la interfaz no protege
nada.

### El bloqueo por intentos

Un PIN de 4 dígitos son 10 000 combinaciones: se agotan en minutos con un script.
El hash no lo evita — lo evita limitar los intentos.

El contador es **global**, no por IP. Hay un solo usuario, y limitar por IP
dejaría recorrer todo el espacio de PINs rotando direcciones. El precio es que
alguien podría dejarte fuera 15 minutos a propósito; para un presupuesto
personal, es el intercambio bueno.

Se cuenta con una función de PostgreSQL en vez de leer-sumar-escribir desde la
aplicación: así cien peticiones a la vez no leen el mismo contador y prueban cien
PINs con un único fallo apuntado.

Un PIN mal formado (tres dígitos, letras) **no gasta intento**: no puede acertar,
y contarlo dejaría que un fallo de la interfaz te encerrara.

### La ingesta va por libre

`/api/ingest/bcp` **no pasa por el login**. Google Apps Script no tiene navegador
ni cookies; su autorización es la cabecera `x-ingest-key`, como siempre. Son dos
mecanismos para dos clientes distintos y no se mezclan:

```
Tú           → cookie de sesión firmada  → páginas y Server Actions
Apps Script  → x-ingest-key              → /api/ingest/bcp
```

### Cerrar sesión

El enlace de la cabecera borra la cookie y devuelve a `/login`. Como la sesión es
autocontenida y no hay tabla que vaciar, cerrar sesión afecta solo a ESE
navegador. Para invalidar todas a la vez —un móvil perdido— se cambia
`AUTH_SESSION_SECRET`: todas las cookies emitidas dejan de verificar.

---

## Movimientos: campos, grupos y CRUD

Cada movimiento tiene: Fecha, Hora, **Movimiento** (antes «Empresa»), Categoría,
**Grupo**, Tipo, Tarjeta, Monto, N° de operación, Comentario y Origen.

**Toda la interfaz funciona en soles.** No hay columna de moneda ni selector: un
consumo en dólares se convierte al ingresarlo y se guarda ya en PEN.

**Las tablas son de solo lectura.** Ni siquiera la categoría se edita desde la
lista: mostrarla como desplegable invitaba a cambiarla de un clic, y a cambiar la
equivocada al desplazarse con la rueda del ratón. El único camino para modificar
un movimiento es **Editar**, que abre el formulario completo y valida todo junto.

### Origen

| Valor | Cuándo |
|---|---|
| `EMAIL` | Llegó por Gmail |
| `MANUAL` | Lo creaste con «+ Nuevo movimiento» |

**No es editable.** Un movimiento que vino de un correo lo sigue siendo siempre,
y editarlo no lo convierte en manual. Se fija en el servidor, nunca desde el
formulario.

### Grupo → Categoría resumen → Categoría

Tres niveles, y **solo el último lo elige el usuario**. Los otros dos se derivan
y no se guardan en la base de datos: se calculan al leer. Así nunca hay dos
verdades que puedan discrepar, y reagrupar categorías mañana no exige migración
ni toca un solo movimiento.

El catálogo se declara **encadenado**, no por duplicado: cada categoría dice a
qué resumen pertenece, y cada resumen a qué grupo. Eso hace imposible la
incoherencia que sí permitirían dos mapeos separados —que «Luz» apuntara a
«Servicios del hogar» y a la vez a un grupo distinto del resto de esa familia—.

| Grupo | Categoría resumen | Categorías |
|---|---|---|
| `INGRESOS` | Ingresos | Ingresos |
| `GASTOS FIJOS` | Suscripciones | Suscripciones |
| | Servicios del hogar | Servicios · Luz · Gas Cálidda · Mantenimiento |
| | Educación | Educación |
| | Seguros e impuestos | Seguros · Impuestos y tributos |
| `GASTOS VARIABLES` | Alimentación | Supermercado · Restaurantes · Delivery · Café y snacks |
| | Movilidad | Transporte · Movilidad Taxi · Peajes y estacionamiento |
| | Vehículo | Combustible · Mantenimiento Vehículo |
| | Salud y bienestar | Salud · Farmacia · Cuidado personal |
| | Entretenimiento | Entretenimiento |
| | Hogar | Hogar |
| | Compras personales | Ropa |
| | Tecnología y compras | Tecnología · Compras online |
| | Regalos | Regalos |
| | Transferencias | Transferencias |
| | Otros | Otros |
| *(sin grupo)* | — | Sin categoría |

29 categorías en 16 categorías resumen. **Añadir una es añadir una línea** a
`lib/categories.ts`: no hay tabla, ni `seed`, ni migración.

El formulario **muestra la categoría resumen y el grupo, pero bloqueados**: se recalcula en cuanto
cambias la categoría. El campo no lleva atributo `name`, así que ni siquiera
viaja al servidor. Y aunque alguien lo inyectara, el servidor lo ignora y vuelve
a derivarlo — hay un test que intenta colar un gasto dentro de INGRESOS y
comprueba que no lo consigue.

Un movimiento **sin categoría no se reparte** entre fijos y variables: cuenta
aparte en «Pendiente de categorizar». Repartirlo daría totales que parecen
correctos sin serlo. Nada se clasifica automáticamente, ni siquiera lo que llega
por correo.

### Eliminar es una baja lógica

«Eliminar» **no borra nada**. Marca el movimiento con `activo = false` y sella
`eliminado_at`, y la fila sigue en la tabla con su id, su correo de origen y su
trazabilidad de divisa intactos.

| | |
|---|---|
| Dónde va | A la pestaña **Eliminados** |
| Dónde deja de contar | Resumen, Movimientos, todos los indicadores y el resumen por categoría |
| Cómo vuelve | **Restaurar**, que reactiva la MISMA fila: mismo id, mismo importe |

El filtro por `activo` se aplica **en la consulta**, no al pintar, así que
ninguna vista ni ningún indicador puede olvidarse de excluir las bajas.

Los dos campos van siempre juntos, y un `CHECK` en la base de datos lo obliga:
activo sin fecha de baja, o inactivo con ella. Nunca puede quedar un estado a
medias que la papelera no sepa fechar.

Esto además **arregla un problema del borrado físico**: al eliminar un movimiento
venido de Gmail, su `email_ingestion` quedaba en `PROCESSED` pero sin
transacción, y reprocesar el correo respondía `ALREADY_PROCESSED` sin volver a
crearla — el movimiento era irrecuperable. Ahora la fila nunca desaparece, así
que la idempotencia sigue intacta *y* el movimiento se puede recuperar. Un correo
reprocesado tampoco resucita una baja: eso lo decide el usuario.

> `npm run db:clear` es otra cosa: es la herramienta de mantenimiento para vaciar
> datos de prueba, y esa sí borra de verdad.

### Ordenar los movimientos

| Parámetro | Efecto |
|---|---|
| *(ninguno)* | Lo más reciente primero |
| `?orden=antiguos` | Lo más antiguo primero |
| `?orden=monto-desc` | Mayor monto |
| `?orden=monto-asc` | Menor monto |

En escritorio se ordena pulsando la cabecera **Monto** —primer clic mayor a
menor, el siguiente al revés—; en móvil, con el selector **Ordenar por**, porque
en tarjetas no hay cabecera que pulsar. Cada uno aparece solo en su tamaño: tener
los dos a la vez invitaría a preguntarse cuál manda.

**El orden vive en la URL, no en el estado de un componente.** Los filtros son un
formulario GET, así que aplicarlos navega y un orden guardado en memoria se
perdería en cada filtrado. Al estar en la URL: se conserva al filtrar, lo
comparten la cabecera y el selector sin coordinarse, sobrevive a cambiar el
tamaño de la ventana, y «Limpiar» —que es un enlace a la ruta pelada— lo quita
sin necesidad de reiniciar nada a mano.

Se ordena en el `ORDER BY` de la consulta, no sobre la lista ya leída: así se
ordenan todos los movimientos que cumplen los filtros, que es lo que importará el
día que haya paginación. Al ordenar por monto, la fecha queda de desempate: dos
gastos iguales se leen mejor del más reciente al más antiguo que en orden
arbitrario.

### Totales por grupo y categoría

El resumen los muestra en una tabla dinámica de tres niveles, plegable:

```
▼ GASTOS FIJOS                       5      S/ 925.60
    ▼ Seguros e impuestos            2      S/ 616.60
        Seguros                      2      S/ 616.60
    ▼ Servicios del hogar            3      S/ 309.00
        Servicios                    3      S/ 309.00
```

Se suma **de abajo arriba**: el total de un resumen es la suma de sus categorías
y el de un grupo la de sus resúmenes, de modo que los tres niveles cuadran por
construcción. Sumar cada nivel por separado daría los mismos números hoy y
permitiría que dejaran de cuadrar mañana.

Al entrar nace **desplegado hasta categoría resumen**: los grupos abiertos y sus
resúmenes cerrados. Es el nivel en el que se responde «¿en qué se me va el
dinero?» sin leer veintinueve filas. No se recuerda entre visitas —es estado de
componente, no `localStorage`—, pero sí se conserva al cambiar los filtros.

Se puede ordenar por mayor o menor monto. El orden se aplica **dentro de cada
nivel**, nunca entre niveles: una categoría no puede aparecer fuera de su
resumen ni un resumen fuera de su grupo.

Plegar y ordenar son lo único que vive en el cliente, porque no cambian qué
movimientos se están mirando. Los filtros, que sí, siguen en la URL.

### Indicadores

```
Gastos Totales = Gastos Fijos + Gastos Variables
Balance        = Ingresos - Gastos Totales
```

Se calculan sobre **exactamente los mismos movimientos que se listan**, no con
una consulta aparte, así que el total y la lista no pueden contradecirse. Todos
responden a los filtros activos.

### Filtros

Compartidos entre Resumen, Movimientos y Eliminados, con el mismo contrato de URL:

| Parámetro | Ejemplo |
|---|---|
| `mes` | `?mes=2026-08` |
| `desde` / `hasta` | `?desde=2026-08-01&hasta=2026-08-15` |
| `categoriaResumen` | `?categoriaResumen=Alimentaci%C3%B3n` |
| `categoria` | `?categoria=Restaurantes` |
| `grupo` | `?grupo=GASTOS%20VARIABLES` |

Los tres niveles se traducen a un filtro sobre `category`, que es lo único que
existe en la base de datos, y se aplica **el más específico**: pedir a la vez
«Alimentación» y «Delivery» devuelve Delivery, no toda la familia.

Con una categoría resumen elegida, el desplegable de categoría **solo ofrece las
suyas**. Sin eso se puede pedir «Alimentación» + «Luz», que no devuelve nada y se
lee como un fallo en vez de como una combinación imposible.

El rango personalizado **tiene prioridad** sobre el mes, y la interfaz atenúa el
selector de mes cuando hay un rango activo para que se vea cuál manda.

---

## Conversión USD → PEN

Un consumo internacional llega así:

```
Realizaste un consumo de $ 16.25 con tu Tarjeta de Crédito BCP en NETFLIX.COM.
```

El parser detecta la moneda, `lib/exchangeRate.ts` obtiene el tipo de cambio de
**la fecha de la operación**, y se guarda ya convertido.

### La API

**SUNAT**, vía `api.apis.net.pe`. Sin API key, histórica por fecha, y es el tipo
de cambio **oficial peruano**. Una API genérica de divisas daría el tipo
interbancario, que no es el que aplica el banco.

Se usa el valor de **venta**: al pagar en dólares con una tarjeta peruana, el
banco te vende dólares.

### La caché — por qué existe

La API gratuita corta con **HTTP 429** tras unas pocas peticiones por minuto. Sin
caché, casi todas las conversiones acabarían usando el fallback y el importe
sería materialmente incorrecto (3.4 frente a ~3.35 real).

El tipo de cambio de una fecha pasada no cambia nunca, así que se consulta **una
sola vez por fecha** y se guarda en la tabla `exchange_rates`.

### El fallback

```
PEN → se guarda directamente, sin conversión
USD → SUNAT → si falla → DEFAULT_USD_PEN_RATE (3.4) → se guarda en PEN
```

`DEFAULT_USD_PEN_RATE` está definido **una sola vez**, en `lib/exchangeRate.ts`.
Cuando se usa queda registrado en el log (`exchangeRate.fallback`) y **la
transacción se procesa igualmente**: perder el movimiento sería peor que
guardarlo con un importe aproximado y auditable.

### Trazabilidad

Aunque la interfaz solo muestre soles, cada conversión deja constancia:

| Columna | Ejemplo |
|---|---|
| `amount` / `currency` | `54.41` / `PEN` |
| `original_amount` / `original_currency` | `16.25` / `USD` |
| `exchange_rate` | `3.348000` |
| `exchange_rate_date` | `2026-08-28` |
| `exchange_rate_source` | `API` o `FALLBACK` |

Si el correo ya viene en soles, esas cinco columnas quedan a `NULL`.

---

## Notas de seguridad

- `SUPABASE_SERVICE_ROLE_KEY` solo se usa en el servidor y nunca lleva prefijo
  `NEXT_PUBLIC_`.
- `x-ingest-key` se compara en tiempo constante, sobre hashes SHA-256.
- Si `GMAIL_INGEST_KEY` no está configurada, el endpoint responde 500: nunca se
  queda abierto por un olvido de configuración.
- El PIN nunca se guarda: en `AUTH_PIN_HASH` vive solo su derivación scrypt, y
  nunca sale hacia el navegador.
- La cookie de sesión es `HttpOnly`: el JavaScript de la página no puede leerla,
  así que un XSS no se la lleva.
- 5 intentos fallidos bloquean el acceso 15 minutos, contados en base de datos.
- Las Server Actions comprueban la sesión ellas mismas: proteger solo las páginas
  dejaría los endpoints abiertos.
- Los logs registran identificadores, estados y longitudes. Nunca secretos: ni el
  PIN introducido, ni su hash.
- RLS activado sin policies: sin la service_role key no se lee nada.
- `.env.local` está en `.gitignore`.
