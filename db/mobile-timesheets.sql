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
