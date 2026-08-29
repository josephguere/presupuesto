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
