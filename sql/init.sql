-- ============================================================================
--  Presupuesto — esquema inicial (MVP)
--  Ejecutar en: Supabase → SQL Editor → New query → Run
--
--  El script es IDEMPOTENTE: puedes ejecutarlo varias veces sin romper nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1. email_ingestions — el correo crudo, tal como llegó de Gmail.
--
--  Se guarda SIEMPRE, incluso si el parser falla. Así un cambio de formato del
--  banco nunca implica perder datos: se corrige el parser y se reprocesa.
-- ---------------------------------------------------------------------------
create table if not exists public.email_ingestions (
  id                uuid primary key default gen_random_uuid(),

  -- Clave de idempotencia: un correo de Gmail entra UNA sola vez.
  gmail_message_id  text not null unique,
  gmail_thread_id   text,

  sender_email      text not null,
  recipient_email   text,
  subject           text,
  received_at       timestamptz,

  raw_body          text not null,
  source            text,

  processing_status text not null default 'RECEIVED'
    constraint email_ingestions_processing_status_check
    check (processing_status in ('RECEIVED', 'PROCESSED', 'PARSE_ERROR', 'ERROR')),
  processing_error  text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.email_ingestions is
  'Correos crudos recibidos desde Gmail. gmail_message_id garantiza idempotencia.';

-- ---------------------------------------------------------------------------
--  2. transactions — la información ya estructurada.
--
--  Separada del correo a propósito: un correo es evidencia, una transacción es
--  dato de negocio. El día que llegue un correo con dos operaciones, esta tabla
--  no cambia de forma.
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id                 uuid primary key default gen_random_uuid(),

  email_ingestion_id uuid not null
    references public.email_ingestions (id) on delete cascade,

  bank               text,
  operation_type     text,
  transaction_at     timestamptz,
  amount             numeric(12, 2),
  currency           char(3),
  merchant           text,
  card_last4         varchar(4),
  operation_number   text,
  category           text,
  source             text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Segunda capa de idempotencia: un correo produce como máximo 1 transacción.
  -- Si el endpoint se ejecuta dos veces en paralelo, PostgreSQL corta el
  -- duplicado y la API resuelve el conflicto leyendo la fila que ya existe.
  constraint transactions_email_ingestion_id_key unique (email_ingestion_id)
);

comment on table public.transactions is
  'Movimientos estructurados extraídos de email_ingestions.';

-- ---------------------------------------------------------------------------
--  3. Índices de consulta
-- ---------------------------------------------------------------------------

-- El dashboard ordena y filtra siempre por fecha descendente.
create index if not exists transactions_transaction_at_idx
  on public.transactions (transaction_at desc);

-- Filtro "Empresa" en /movimientos.
create index if not exists transactions_merchant_idx
  on public.transactions (merchant);

-- Búsqueda de una operación puntual por su número de operación del banco.
create index if not exists transactions_operation_number_idx
  on public.transactions (operation_number);

-- Reprocesamiento: "dame todo lo que quedó en PARSE_ERROR".
create index if not exists email_ingestions_processing_status_idx
  on public.email_ingestions (processing_status);

-- ---------------------------------------------------------------------------
--  3.5. Separacion entre datos de prueba y datos reales
--
--  Local y produccion comparten esta misma base de datos. Sin esta marca, los
--  movimientos creados con `npm run post:sample` apareceria en el dashboard
--  publico y falsearian los totales del mes.
--
--  Quien fija el valor es el ENTORNO donde se ingirio el correo, no el payload:
--  localhost -> true, Vercel -> false. Ver lib/environment.ts.
--
--  El bloque solo actua la PRIMERA vez, cuando la columna aun no existe. Al
--  volver a ejecutar init.sql no toca ningun dato ya clasificado.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'email_ingestions'
       and column_name  = 'is_test'
  ) then
    alter table public.email_ingestions
      add column is_test boolean not null default false;
    alter table public.transactions
      add column is_test boolean not null default false;

    -- Backfill unico. Gmail asigna identificadores hexadecimales largos; los de
    -- las pruebas locales son legibles ("fake-msg-001", "muestra-rappi").
    update public.email_ingestions
       set is_test = true
     where gmail_message_id !~ '^[0-9a-f]{12,}$';

    update public.transactions t
       set is_test = e.is_test
      from public.email_ingestions e
     where e.id = t.email_ingestion_id;
  end if;
end $$;

-- El dashboard filtra por esta columna en cada consulta.
create index if not exists transactions_is_test_idx
  on public.transactions (is_test);

-- ---------------------------------------------------------------------------
--  3.6. Movimientos manuales, comentario, origen y trazabilidad de divisa
--
--  Todo se anade como NULL o con DEFAULT, asi que las filas existentes siguen
--  siendo validas sin tocarlas. No se borra ni se reescribe nada.
--
--  El cambio importante es `email_ingestion_id`: era NOT NULL porque hasta ahora
--  todo movimiento venia de un correo. Los movimientos manuales no tienen
--  correo, asi que pasa a admitir NULL. La restriccion UNIQUE sigue en pie y
--  sigue funcionando: PostgreSQL permite varios NULL en una columna UNIQUE, de
--  modo que un correo sigue produciendo como maximo una transaccion y los
--  manuales no se estorban entre si.
-- ---------------------------------------------------------------------------
alter table public.transactions
  alter column email_ingestion_id drop not null;

alter table public.transactions
  add column if not exists comment text;

-- Como se creo el movimiento. EMAIL para todo lo existente, que vino de Gmail.
alter table public.transactions
  add column if not exists origin text not null default 'EMAIL';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_origin_check'
  ) then
    alter table public.transactions
      add constraint transactions_origin_check check (origin in ('EMAIL', 'MANUAL'));
  end if;
end $$;

-- Trazabilidad de la conversion USD -> PEN. La aplicacion solo muestra soles;
-- esto queda para poder auditar de donde salio la cifra.
alter table public.transactions
  add column if not exists original_amount numeric(12, 2);
alter table public.transactions
  add column if not exists original_currency char(3);
alter table public.transactions
  add column if not exists exchange_rate numeric(12, 6);
alter table public.transactions
  add column if not exists exchange_rate_date date;
alter table public.transactions
  add column if not exists exchange_rate_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_exchange_rate_source_check'
  ) then
    alter table public.transactions
      add constraint transactions_exchange_rate_source_check
      check (exchange_rate_source is null or exchange_rate_source in ('API', 'FALLBACK'));
  end if;
end $$;

-- El filtro por categoria y por grupo se resuelve sobre esta columna.
create index if not exists transactions_category_idx
  on public.transactions (category);

create index if not exists transactions_origin_idx
  on public.transactions (origin);

-- ---------------------------------------------------------------------------
--  3.7. Cache de tipos de cambio
--
--  La API gratuita de SUNAT corta con HTTP 429 tras unas pocas peticiones por
--  minuto. El tipo de cambio de una fecha pasada no cambia nunca, asi que se
--  consulta una sola vez por fecha y se guarda aqui. Sin esto, casi todas las
--  conversiones acabarian usando el fallback y el importe seria incorrecto.
-- ---------------------------------------------------------------------------
create table if not exists public.exchange_rates (
  rate_date  date primary key,
  usd_pen    numeric(12, 6) not null,
  source     text,
  created_at timestamptz not null default now()
);

comment on table public.exchange_rates is
  'Tipo de cambio USD->PEN por fecha. Se consulta a SUNAT una vez y se reutiliza.';

alter table public.exchange_rates enable row level security;

-- ---------------------------------------------------------------------------
--  3.8. Eliminacion logica (soft delete)
--
--  Eliminar un movimiento ya no lo borra: lo desactiva. El registro sigue en la
--  tabla, con su id, su correo de origen y su trazabilidad de divisa intactos,
--  de modo que Restaurar devuelve EXACTAMENTE la misma fila y no una copia.
--
--  Esto tambien arregla un problema que existia con el borrado fisico: al
--  eliminar un movimiento venido de Gmail, su email_ingestion quedaba en estado
--  PROCESSED pero sin transaccion, y reprocesar el correo respondia
--  ALREADY_PROCESSED sin volver a crearla. El movimiento era irrecuperable.
--  Con la baja logica la fila nunca desaparece, asi que la idempotencia sigue
--  intacta y el movimiento se puede recuperar.
--
--  `not null default true` rellena las filas existentes: todo lo que hay hoy
--  queda activo, con eliminado_at a NULL. No se borra ni se reescribe nada.
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column if not exists activo boolean not null default true;

alter table public.transactions
  add column if not exists eliminado_at timestamptz;

-- Los dos campos van siempre juntos. Sin esta restriccion podria aparecer un
-- movimiento inactivo sin fecha de baja, que la pantalla Eliminados no sabria
-- fechar, o uno activo con fecha de baja, que mentiria sobre su estado.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_activo_check'
  ) then
    alter table public.transactions
      add constraint transactions_activo_check
      check ((activo and eliminado_at is null) or (not activo and eliminado_at is not null));
  end if;
end $$;

-- Todas las consultas del dashboard filtran por esta columna.
create index if not exists transactions_activo_idx
  on public.transactions (activo);

-- ---------------------------------------------------------------------------
--  3.9. Control de intentos de acceso (PIN)
--
--  El PIN tiene 4 digitos: 10 000 combinaciones. Un hash, por bueno que sea, no
--  protege de eso; lo que protege es limitar los intentos. Aqui se lleva la
--  cuenta.
--
--  El contador es GLOBAL, no por IP. La aplicacion tiene un unico usuario, y
--  limitar por IP dejaria la puerta abierta a recorrer el espacio de PINs
--  rotando direcciones. El precio es que alguien podria dejarte fuera 15
--  minutos a proposito; para un presupuesto personal, es el intercambio bueno.
--
--  El PIN introducido NO se guarda aqui ni en ningun otro sitio.
-- ---------------------------------------------------------------------------
create table if not exists public.auth_attempts (
  id           text primary key,
  failed_count integer not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

comment on table public.auth_attempts is
  'Intentos fallidos de acceso por PIN. Nunca contiene el PIN.';

alter table public.auth_attempts enable row level security;

-- Registrar un intento tiene que ser ATOMICO: leer, sumar y escribir desde la
-- aplicacion permitiria lanzar cien peticiones a la vez y que todas leyeran el
-- mismo contador, probando cien PINs con un solo fallo contabilizado.
-- `insert ... on conflict do update` bloquea la fila, asi que los intentos
-- simultaneos se serializan y ninguno se pierde.
create or replace function public.register_auth_attempt(
  p_id           text,
  p_success      boolean,
  p_max          integer,
  p_lock_minutes integer
)
returns table (failed_count integer, locked_until timestamptz)
language plpgsql
as $$
begin
  if p_success then
    insert into public.auth_attempts (id, failed_count, locked_until, updated_at)
         values (p_id, 0, null, now())
    on conflict (id) do update
         set failed_count = 0, locked_until = null, updated_at = now();
  else
    insert into public.auth_attempts as a (id, failed_count, locked_until, updated_at)
         values (p_id, 1, null, now())
    on conflict (id) do update
         set failed_count = case
               -- Si el bloqueo anterior ya vencio, se empieza a contar de cero.
               when a.locked_until is not null and a.locked_until <= now() then 1
               else a.failed_count + 1
             end,
             locked_until = null,
             updated_at   = now();

    update public.auth_attempts as a
       set locked_until = now() + make_interval(mins => p_lock_minutes)
     where a.id = p_id
       and a.failed_count >= p_max;
  end if;

  return query
    select a.failed_count, a.locked_until
      from public.auth_attempts a
     where a.id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
--  4. updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.email_ingestions;
create trigger set_updated_at
  before update on public.email_ingestions
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.transactions;
create trigger set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
--  5. Seguridad — Row Level Security
--
--  Activamos RLS y NO creamos ninguna policy. Efecto:
--    · La `service_role` key (solo backend) bypassea RLS → lee y escribe todo.
--    · Cualquier otra key (anon / authenticated) no ve absolutamente nada,
--      aunque la URL del proyecto se filtre.
--
--  Es la postura correcta para un MVP de un solo usuario sin login: los datos
--  quedan cerrados por defecto en lugar de abiertos por defecto.
--  Cuando añadamos multi-usuario, aquí van las policies con `auth.uid()`.
-- ---------------------------------------------------------------------------
alter table public.email_ingestions enable row level security;
alter table public.transactions     enable row level security;

-- ---------------------------------------------------------------------------
--  6. Chat de consulta — control de consumo
--
--  El chat llama a Gemini DOS veces por mensaje (intención y redacción), así que
--  una ráfaga de mensajes se traduce en el doble de peticiones contra una cuota
--  que se agota. Esto lo frena.
--
--  Por qué en PostgreSQL y no en memoria del proceso: Vercel es serverless. Un
--  contador en una variable de módulo no se comparte entre instancias ni
--  sobrevive a un arranque en frío, así que abrir dos pestañas bastaría para
--  duplicar el límite. La tabla ya está ahí y el patrón es el mismo que el de
--  `auth_attempts`.
--
--  La tabla NUNCA contiene la pregunta del usuario ni ningún texto suyo: solo un
--  identificador de ventana, un contador y una marca de tiempo.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  id                text primary key,
  hits              integer not null default 0,
  window_started_at timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.rate_limits is
  'Contadores por ventana para limitar el consumo del chat. Nunca contiene texto del usuario.';

alter table public.rate_limits enable row level security;

-- Ventana fija: al primer mensaje de la ventana se anota `window_started_at`, y
-- los siguientes suman hasta que vence.
--
-- Sumar y decidir ocurren en la MISMA sentencia. Hacerlo en dos pasos desde la
-- aplicación permitiría lanzar veinte peticiones a la vez y que todas leyeran el
-- mismo contador; `insert ... on conflict do update ... returning` bloquea la
-- fila y las serializa, igual que en `register_auth_attempt`.
create or replace function public.register_rate_hit(
  p_id             text,
  p_limit          integer,
  p_window_seconds integer
)
returns table (hits integer, allowed boolean, retry_after_seconds integer)
language plpgsql
as $$
declare
  v_hits  integer;
  v_start timestamptz;
begin
  insert into public.rate_limits as r (id, hits, window_started_at, updated_at)
       values (p_id, 1, now(), now())
  on conflict (id) do update
       set hits = case
             when r.window_started_at + make_interval(secs => p_window_seconds) <= now()
             then 1
             else r.hits + 1
           end,
           window_started_at = case
             when r.window_started_at + make_interval(secs => p_window_seconds) <= now()
             then now()
             else r.window_started_at
           end,
           updated_at = now()
    returning r.hits, r.window_started_at into v_hits, v_start;

  return query
    select
      v_hits,
      v_hits <= p_limit,
      greatest(
        0,
        ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))
      )::integer;
end;
$$;

-- ---------------------------------------------------------------------------
--  7. Chat de consulta — catálogo vigente de categorías
--
--  El chat necesita saber qué categorías EXISTEN de verdad para validar lo que
--  el usuario menciona, y tienen que aparecer solas cuando se añade una.
--
--  Aquí no hay tabla de categorías: la jerarquía vive en `lib/categories.ts` y
--  `transactions.category` es una columna de texto. Esta función devuelve el
--  lado que sí es dato —qué categorías se están usando y cuánto—, y la
--  aplicación le une la jerarquía. Ver la cabecera de `lib/ai/catalog.ts`.
--
--  Es una función y no un `select` desde la aplicación porque PostgREST no tiene
--  DISTINCT: habría que traerse las filas y deduplicar en memoria, y con el tope
--  de mil filas una categoría poco usada desaparecería del catálogo sin aviso.
--
--  `stable` y de solo lectura: no escribe nada.
-- ---------------------------------------------------------------------------
create or replace function public.catalogo_categorias(
  p_incluir_prueba boolean default false
)
returns table (categoria text, movimientos bigint)
language sql
stable
as $$
  select t.category, count(*)
    from public.transactions t
   where t.activo
     and t.category is not null
     and btrim(t.category) <> ''
     and (p_incluir_prueba or not t.is_test)
   group by t.category
   order by count(*) desc, t.category;
$$;
