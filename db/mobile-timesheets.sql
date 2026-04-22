create table if not exists public.mobile_auth_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.app_users(id) on delete cascade,
  login_email text not null unique,
  password_hash text not null,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mobile_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.mobile_auth_accounts(id) on delete cascade,
  session_token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mobile_auth_sessions_account_id
  on public.mobile_auth_sessions (account_id);

create index if not exists idx_mobile_auth_sessions_active
  on public.mobile_auth_sessions (session_token_hash, expires_at)
  where revoked_at is null;

drop trigger if exists set_updated_at_mobile_auth_accounts on public.mobile_auth_accounts;
create trigger set_updated_at_mobile_auth_accounts
before update on public.mobile_auth_accounts
for each row execute function public.set_updated_at();

insert into public.mobile_auth_accounts (
  user_id,
  login_email,
  password_hash,
  is_active
)
select
  au.id,
  'rahulnegi@drilling.co.nz',
  'scrypt$3930b92ab620974eaecf85a54fb9f839$69a19a9b1048bf74c6360b8a43eff6feccda695c3bd83330b854ae19c37ba03117c1a53d2b5477a6973b5739b053f6754c5ecf0ceb3cf248ed71575c2987e4af',
  true
from public.app_users au
where lower(au.email) = lower('rahulnegi@drilling.co.nz')
on conflict (login_email) do update
set
  user_id = excluded.user_id,
  password_hash = excluded.password_hash,
  is_active = excluded.is_active,
  updated_at = now();

create or replace view public.jobs_mobile_lookup_vw as
select
  j.id::text as id,
  j.job_number::text as job_code,
  j.title::text as job_name,
  c.name::text as client_name,
  coalesce(j.site_name::text, j.site_address::text, 'Unknown site') as site_name,
  (j.status in ('approved', 'active', 'on_hold')) as is_active
from public.jobs j
join public.clients c on c.id = j.client_id;
