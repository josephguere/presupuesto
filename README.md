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
│   └── api/ingest/bcp/
│       ├── route.ts                   POST de ingesta + GET de salud
│       └── route.test.ts              Tests de idempotencia y seguridad
├── components/
│   ├── SummaryCards.tsx               Las 4 métricas del mes
│   ├── CategorySelect.tsx             Combo de categoría (Client Component)
│   ├── TransactionsTable.tsx          Tarjetas en móvil, tabla en escritorio
│   └── SetupNotice.tsx                Aviso si falta configuración
├── lib/
│   ├── format.ts                      Intl es-PE / America/Lima
│   ├── categories.ts                  Lista de categorías de gasto
│   ├── environment.ts                 Corte entre datos de prueba y reales
│   ├── logger.ts                      Logs estructurados, sin secretos
│   ├── transactions.ts                Lectura de movimientos y resumen
│   ├── ingest/security.ts             Clave, remitente, filtro de asunto
│   ├── parsers/
│   │   ├── types.ts                   Contrato común de los parsers
│   │   ├── normalize.ts               Texto, montos y fechas en español
│   │   ├── bcpConsumo.ts              Parser de consumos BCP (débito y crédito)
│   │   ├── bcpConsumo.test.ts         49 tests del parser
│   │   └── bcp.ts                     Punto de entrada del banco BCP
│   └── supabase/
│       ├── client.ts                  Fábrica compartida (sin secretos)
│       └── server.ts                  Cliente service-role, solo servidor
├── types/transaction.ts               Tipos de dominio y filas de BD
├── sql/init.sql                       Esquema completo
├── google-apps-script/gmail-bcp.gs    Script de Gmail
├── scripts/
│   ├── db-init.ts                     Aplicar y verificar el esquema
│   ├── loadEnv.ts                     Cargar .env.local en los scripts
│   ├── parse-sample.ts                Probar el parser sin Gmail
│   └── post-sample.ts                 Probar el endpoint sin Gmail
└── samples/                           Correos de ejemplo
    ├── bcp-consumo.txt                formato con dos puntos
    ├── bcp-consumo-credito.txt        formato real del BCP
    ├── bcp-consumo-plaza-vea.txt      millares y hora AM
    └── bcp-consumo-html.txt           HTML→texto con caracteres invisibles
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

## 11. Desplegar en Vercel

1. Sube el repositorio a GitHub.
2. <https://vercel.com> → **Add New** → **Project** → importa el repositorio.
3. Framework: **Next.js** (se detecta solo). No cambies nada más.
4. Añade las variables de entorno (paso 12) **antes** del primer despliegue.
5. **Deploy**.

Anota la URL, p. ej. `https://presupuesto-tuusuario.vercel.app`.

---

## 12. Configurar las variables en Vercel

**Project** → **Settings** → **Environment Variables**. Añade las tres para los
entornos *Production*, *Preview* y *Development*:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | La URL de tu proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | La service_role key |
| `GMAIL_INGEST_KEY` | La misma clave que en Apps Script |

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

## Notas de seguridad

- `SUPABASE_SERVICE_ROLE_KEY` solo se usa en el servidor y nunca lleva prefijo
  `NEXT_PUBLIC_`.
- `x-ingest-key` se compara en tiempo constante, sobre hashes SHA-256.
- Si `GMAIL_INGEST_KEY` no está configurada, el endpoint responde 500: nunca se
  queda abierto por un olvido de configuración.
- Los logs registran identificadores, estados y longitudes. Nunca secretos.
- RLS activado sin policies: sin la service_role key no se lee nada.
- `.env.local` está en `.gitignore`.
