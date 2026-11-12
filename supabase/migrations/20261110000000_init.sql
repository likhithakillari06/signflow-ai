-- SignFlow AI — initial schema
-- Run once against a Supabase project (SQL editor, or `supabase db push`).
--
-- Security model
--   * Every admin query runs as the Postgres role `authenticated` with the user's id in
--     request.jwt.claims, so the Row Level Security policies below are the enforcement point.
--   * Signing requests, submitted values, audit events and rate limits are written only by
--     trusted server code (table owner / service role). Workspace members can read, never write.
--   * `anon` gets nothing. Signers never talk to the database; the server checks their token.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  -- Template sent automatically when a new file is opened (nullable = automation off).
  default_template_id uuid,
  link_expiry_days integer not null default 14 check (link_expiry_days between 1 and 90),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  email text not null check (char_length(email) between 3 and 254),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index clients_workspace_idx on public.clients(workspace_id, created_at desc);

-- A "file": one job or case for one client.
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null,
  reference text not null check (char_length(reference) between 1 and 60),
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'intake'
    check (status in ('intake', 'awaiting_signature', 'active', 'closed')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, reference),
  -- Composite key: a case can only point at a client in the same workspace.
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete restrict
);
create index cases_workspace_idx on public.cases(workspace_id, created_at desc);
create index cases_client_idx on public.cases(client_id);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  storage_path text not null unique,
  page_count integer not null check (page_count > 0),
  file_size integer not null check (file_size > 0),
  sha256 text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  -- Files live under the owning workspace's folder; a row can never point at another tenant's file.
  check (storage_path like workspace_id::text || '/%')
);
create index templates_workspace_idx on public.templates(workspace_id, created_at desc);

alter table public.workspaces
  add constraint workspaces_default_template_fk
  foreign key (id, default_template_id) references public.templates(workspace_id, id);

-- Field layout stored on a template. Never holds values or signatures.
create table public.template_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates(id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  field_type text not null check (field_type in ('signature', 'initials', 'name', 'date', 'text')),
  -- Fractions (0..1) of the page as displayed, origin top-left. Independent of zoom and screen.
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),
  width double precision not null check (width > 0 and width <= 1),
  height double precision not null check (height > 0 and height <= 1),
  required boolean not null default true,
  label text check (label is null or char_length(label) <= 80),
  check (x + width <= 1.0005 and y + height <= 1.0005)
);
create index template_fields_template_idx on public.template_fields(template_id);

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null,
  template_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  original_storage_path text not null unique,
  original_sha256 text not null,
  original_size integer not null check (original_size > 0),
  page_count integer not null check (page_count > 0),
  completed_storage_path text,
  completed_sha256 text,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'sent', 'viewed', 'signed', 'expired', 'cancelled', 'failed')),
  failure_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  signed_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete restrict,
  foreign key (workspace_id, template_id) references public.templates(workspace_id, id) on delete restrict,
  check (original_storage_path like workspace_id::text || '/%'),
  check (completed_storage_path is null or completed_storage_path like workspace_id::text || '/%'),
  -- "Signed" always comes with a stored document.
  check (status <> 'signed' or (completed_storage_path is not null and signed_at is not null))
);
create index agreements_workspace_idx on public.agreements(workspace_id, created_at desc);
create index agreements_case_idx on public.agreements(case_id);
create index agreements_status_idx on public.agreements(workspace_id, status);

-- Who signs. One signer per agreement in this version (see README: multi-party signing).
create table public.agreement_signers (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null unique references public.agreements(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  email text not null check (char_length(email) between 3 and 254),
  created_at timestamptz not null default now()
);

create table public.signing_fields (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  field_type text not null check (field_type in ('signature', 'initials', 'name', 'date', 'text')),
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),
  width double precision not null check (width > 0 and width <= 1),
  height double precision not null check (height > 0 and height <= 1),
  required boolean not null default true,
  label text check (label is null or char_length(label) <= 80),
  assigned_signer_id uuid references public.agreement_signers(id) on delete set null,
  check (x + width <= 1.0005 and y + height <= 1.0005)
);
create index signing_fields_agreement_idx on public.signing_fields(agreement_id);

-- One row per issued signing link. Rotating a link revokes the old row and adds a new one.
create table public.signing_requests (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  signer_id uuid references public.agreement_signers(id) on delete set null,
  signer_name text not null,
  signer_email text not null,
  token_hash text not null unique,              -- SHA-256 of the link token; the token itself is never stored
  expires_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'viewed', 'completed', 'expired', 'revoked')),
  email_status text not null default 'not_requested'
    check (email_status in ('not_requested', 'not_configured', 'accepted', 'failed')),
  email_error text,
  email_provider_id text,
  email_attempted_at timestamptz,
  first_viewed_at timestamptz,
  consent_at timestamptz,
  consent_text text,
  signer_ip text,
  signer_user_agent text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index signing_requests_agreement_idx on public.signing_requests(agreement_id, created_at desc);
-- At most one live link per agreement.
create unique index signing_requests_one_active_idx
  on public.signing_requests(agreement_id) where status in ('pending', 'viewed');
-- At most one completed signing per agreement (second line of defence against double finalisation).
create unique index signing_requests_one_completed_idx
  on public.signing_requests(agreement_id) where status = 'completed';

create table public.signing_field_values (
  id uuid primary key default gen_random_uuid(),
  signing_request_id uuid not null references public.signing_requests(id) on delete cascade,
  signing_field_id uuid not null references public.signing_fields(id) on delete cascade,
  value_type text not null check (value_type in ('text', 'image')),
  -- Text value, or for images the private storage path of the PNG.
  value text not null,
  -- For signatures/initials: how it was made ('drawn' | 'typed').
  method text check (method in ('drawn', 'typed')),
  created_at timestamptz not null default now(),
  unique (signing_request_id, signing_field_id)
);

-- Append-only history, kept apart from the editable agreement row.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  -- Strict insertion order, even for events written in the same transaction.
  seq bigint generated always as identity,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  signing_request_id uuid references public.signing_requests(id) on delete set null,
  event_type text not null,
  actor_type text not null check (actor_type in ('admin', 'signer', 'system')),
  actor_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index audit_events_agreement_idx on public.audit_events(agreement_id, seq);
create index audit_events_workspace_idx on public.audit_events(workspace_id, created_at desc);

-- Fixed-window counters for the public signing endpoints.
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------------------------

create function public.audit_events_immutable() returns trigger
language plpgsql as $$
begin
  -- Rows may only disappear when the whole workspace/agreement is deleted (cascade).
  if tg_op = 'UPDATE' then
    raise exception 'audit events are append-only';
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() < 2 then
    raise exception 'audit events are append-only';
  end if;
  return coalesce(new, old);
end $$;

create trigger audit_events_no_update before update on public.audit_events
  for each row execute function public.audit_events_immutable();
create trigger audit_events_no_delete before delete on public.audit_events
  for each row execute function public.audit_events_immutable();

create function public.agreements_guard() returns trigger
language plpgsql as $$
begin
  if new.original_storage_path is distinct from old.original_storage_path
     or new.original_sha256 is distinct from old.original_sha256 then
    raise exception 'the original document of an agreement cannot be replaced';
  end if;
  if old.status in ('signed', 'cancelled') and new.status is distinct from old.status then
    raise exception 'agreement is % and can no longer change status', old.status;
  end if;
  if old.status = 'signed' and (
       new.completed_storage_path is distinct from old.completed_storage_path
       or new.completed_sha256 is distinct from old.completed_sha256
       or new.signed_at is distinct from old.signed_at) then
    raise exception 'a signed agreement cannot be modified';
  end if;
  return new;
end $$;

create trigger agreements_guard before update on public.agreements
  for each row execute function public.agreements_guard();

-- Field layout is frozen once a link has been issued: the signer signs what was prepared.
create function public.signing_fields_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_status text;
begin
  select status into parent_status from public.agreements
   where id = coalesce(new.agreement_id, old.agreement_id);
  if parent_status is not null and parent_status not in ('draft', 'ready') then
    raise exception 'fields cannot be changed while the agreement is %', parent_status;
  end if;
  return coalesce(new, old);
end $$;

create trigger signing_fields_guard before insert or update or delete on public.signing_fields
  for each row execute function public.signing_fields_guard();

-- ---------------------------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------------------------

create function public.is_workspace_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
     where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create function public.can_access_agreement(agreement uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.agreements a
      join public.workspace_members m on m.workspace_id = a.workspace_id
     where a.id = agreement and m.user_id = auth.uid()
  );
$$;

create function public.can_access_template(template uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.templates t
      join public.workspace_members m on m.workspace_id = t.workspace_id
     where t.id = template and m.user_id = auth.uid()
  );
$$;

-- Returns true while the caller is within the limit. Server-only.
create function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c integer;
begin
  insert into public.rate_limits as r (key, window_start, count) values (p_key, w, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into c;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return c <= p_max;
end $$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.can_access_agreement(uuid) from public, anon;
revoke all on function public.can_access_template(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.can_access_agreement(uuid) to authenticated;
grant execute on function public.can_access_template(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Privileges: start from nothing, then grant exactly what the app uses
-- ---------------------------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.workspaces to authenticated;
grant update (name, default_template_id, link_expiry_days) on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.cases to authenticated;
grant select, insert on public.templates to authenticated;
grant update (name, archived_at) on public.templates to authenticated;
grant select, insert, update, delete on public.template_fields to authenticated;
-- Agreements are created and moved between statuses by server code only, so a member cannot
-- mark something "signed" by talking to the database directly.
grant select on public.agreements to authenticated;
grant update (title) on public.agreements to authenticated;
grant select, insert, update, delete on public.agreement_signers to authenticated;
grant select, insert, update, delete on public.signing_fields to authenticated;
grant select on public.signing_field_values to authenticated;
grant select on public.audit_events to authenticated;
-- Everything except token_hash.
grant select (id, agreement_id, signer_id, signer_name, signer_email, expires_at, status,
              email_status, email_error, email_provider_id, email_attempted_at, first_viewed_at,
              consent_at, consent_text, signer_ip, signer_user_agent, created_by, created_at,
              completed_at)
  on public.signing_requests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.clients enable row level security;
alter table public.cases enable row level security;
alter table public.templates enable row level security;
alter table public.template_fields enable row level security;
alter table public.agreements enable row level security;
alter table public.agreement_signers enable row level security;
alter table public.signing_fields enable row level security;
alter table public.signing_requests enable row level security;
alter table public.signing_field_values enable row level security;
alter table public.audit_events enable row level security;
alter table public.rate_limits enable row level security;

create policy workspaces_select on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_workspace_member(id)) with check (public.is_workspace_member(id));

create policy members_select on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy clients_all on public.clients for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create policy cases_all on public.cases for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create policy templates_select on public.templates for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy templates_insert on public.templates for insert to authenticated
  with check (public.is_workspace_member(workspace_id));
create policy templates_update on public.templates for update to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create policy template_fields_all on public.template_fields for all to authenticated
  using (public.can_access_template(template_id)) with check (public.can_access_template(template_id));

create policy agreements_select on public.agreements for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy agreements_update on public.agreements for update to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create policy agreement_signers_all on public.agreement_signers for all to authenticated
  using (public.can_access_agreement(agreement_id)) with check (public.can_access_agreement(agreement_id));

create policy signing_fields_all on public.signing_fields for all to authenticated
  using (public.can_access_agreement(agreement_id)) with check (public.can_access_agreement(agreement_id));

-- Read-only for members; rows are written by trusted server code only.
create policy signing_requests_select on public.signing_requests for select to authenticated
  using (public.can_access_agreement(agreement_id));
create policy signing_field_values_select on public.signing_field_values for select to authenticated
  using (exists (select 1 from public.signing_requests r
                  where r.id = signing_request_id and public.can_access_agreement(r.agreement_id)));
create policy audit_events_select on public.audit_events for select to authenticated
  using (public.is_workspace_member(workspace_id));
-- rate_limits: no policies on purpose.

-- ---------------------------------------------------------------------------------------------
-- Private storage bucket. No storage policies: only the server (service role) touches files,
-- and it hands out short-lived signed URLs after checking who is asking.
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agreements', 'agreements', false, 20971520, array['application/pdf', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
