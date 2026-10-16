-- Casper Lost Dogs - Supabase schema
-- Run this whole file once in your Supabase project: Dashboard > SQL Editor > New query > paste > Run.
-- It is safe to run again (it uses IF NOT EXISTS / OR REPLACE).
--
-- Security model
--   * Anyone can READ reports and sightings (it's a public community map).
--   * Anyone can ADD a report or a sighting, but only through the create_report / add_sighting
--     functions below, which validate and trim the input. There is no direct INSERT/UPDATE/DELETE
--     access to the tables for the public (anon) role.
--   * create_report returns a random owner key once. Only its SHA-256 hash is stored, in a table
--     the public cannot read. reunite_report only works with the matching key.
--   * Photos go to a public Storage bucket "dog-photos" (images only, max 6 MB). Anyone can upload,
--     nobody can overwrite or delete through the public key.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------
create table if not exists public.reports (
  id              uuid primary key default gen_random_uuid(),
  status          text not null check (status in ('lost', 'spotted')),
  reunited        boolean not null default false,
  reunited_at     timestamptz,
  name            text not null default '' check (char_length(name) <= 60),
  breed           text not null default '' check (char_length(breed) <= 80),
  color           text not null default '' check (char_length(color) <= 120),
  description     text not null default '' check (char_length(description) <= 1000),
  photo           text check (photo is null or char_length(photo) <= 500),
  seen_at         timestamptz not null default now(),
  lat             double precision not null check (lat between -90 and 90),
  lng             double precision not null check (lng between -180 and 180),
  location_label  text not null default '' check (char_length(location_label) <= 120),
  contact_name    text not null check (char_length(contact_name) between 1 and 80),
  contact_phone   text not null default '' check (char_length(contact_phone) <= 40),
  contact_email   text not null default '' check (char_length(contact_email) <= 120),
  linked_to       uuid references public.reports(id) on delete set null,
  sample          boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists reports_created_at_idx on public.reports (created_at desc);

create table if not exists public.sightings (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.reports(id) on delete cascade,
  lat             double precision not null check (lat between -90 and 90),
  lng             double precision not null check (lng between -180 and 180),
  seen_at         timestamptz not null default now(),
  note            text not null default '' check (char_length(note) <= 600),
  contact_name    text not null default '' check (char_length(contact_name) <= 80),
  contact         text not null default '' check (char_length(contact) <= 120),
  photo           text check (photo is null or char_length(photo) <= 500),
  from_report_id  uuid references public.reports(id) on delete set null,  -- set when a "spotted" report was linked
  created_at      timestamptz not null default now()
);
create index if not exists sightings_report_idx on public.sightings (report_id);

-- Owner key hashes live apart from reports so they are never readable by the public.
create table if not exists public.report_owner_keys (
  report_id        uuid primary key references public.reports(id) on delete cascade,
  owner_token_hash text not null
);

-- ---------- row level security ----------
alter table public.reports           enable row level security;
alter table public.sightings         enable row level security;
alter table public.report_owner_keys enable row level security;   -- no policies = no public access

drop policy if exists "Public can read reports" on public.reports;
create policy "Public can read reports" on public.reports for select to anon, authenticated using (true);

drop policy if exists "Public can read sightings" on public.sightings;
create policy "Public can read sightings" on public.sightings for select to anon, authenticated using (true);

revoke insert, update, delete on public.reports, public.sightings from anon, authenticated;
revoke all on public.report_owner_keys from anon, authenticated;
grant select on public.reports, public.sightings to anon, authenticated;

-- ---------- functions (the only way the public can write) ----------
create or replace function public.create_report(
  p_status text, p_name text, p_breed text, p_color text, p_description text, p_photo text,
  p_seen_at timestamptz, p_lat double precision, p_lng double precision, p_location_label text,
  p_contact_name text, p_contact_phone text, p_contact_email text, p_linked_to uuid default null
) returns table (report_id uuid, owner_token text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_token text := encode(extensions.gen_random_bytes(16), 'hex');
  v_name text := left(btrim(coalesce(p_name, '')), 60);
  v_contact text := left(btrim(coalesce(p_contact_name, '')), 80);
  v_phone text := left(btrim(coalesce(p_contact_phone, '')), 40);
  v_email text := left(btrim(coalesce(p_contact_email, '')), 120);
  v_desc text := left(btrim(coalesce(p_description, '')), 1000);
  v_breed text := left(btrim(coalesce(p_breed, '')), 80);
  v_color text := left(btrim(coalesce(p_color, '')), 120);
  v_seen timestamptz := least(coalesce(p_seen_at, now()), now() + interval '1 day');
  v_linked uuid;
begin
  if p_status not in ('lost', 'spotted') then raise exception 'Status must be "lost" or "spotted".'; end if;
  if p_lat is null or p_lng is null then raise exception 'Please set a location on the map.'; end if;
  if v_contact = '' or (v_phone = '' and v_email = '') then raise exception 'Contact name and a phone or email are required.'; end if;
  if p_status = 'lost' and v_name = '' then raise exception 'Please enter the dog''s name.'; end if;
  if p_photo is not null and p_photo !~ '^https://[^ ]+/storage/v1/object/public/dog-photos/' then raise exception 'Invalid photo URL.'; end if;
  if p_status = 'spotted' and p_linked_to is not null then
    select id into v_linked from reports where id = p_linked_to and status = 'lost';
  end if;

  insert into reports (status, name, breed, color, description, photo, seen_at, lat, lng, location_label,
                       contact_name, contact_phone, contact_email, linked_to)
  values (p_status, v_name, v_breed, v_color, v_desc, p_photo, v_seen, p_lat, p_lng,
          left(btrim(coalesce(p_location_label, '')), 120), v_contact, v_phone, v_email, v_linked)
  returning id into v_id;

  insert into report_owner_keys (report_id, owner_token_hash) values (v_id, encode(extensions.digest(v_token, 'sha256'), 'hex'));

  -- A spotted report linked to a lost dog also becomes a sighting on that dog's trail
  if v_linked is not null then
    insert into sightings (report_id, lat, lng, seen_at, note, contact_name, contact, photo, from_report_id)
    values (v_linked, p_lat, p_lng, v_seen,
            left(coalesce(nullif(v_desc, ''), btrim('Spotted report: ' || v_breed || ' ' || v_color)), 600),
            v_contact, coalesce(nullif(v_phone, ''), v_email), p_photo, v_id);
  end if;

  return query select v_id, v_token;
end $$;

create or replace function public.add_sighting(
  p_report_id uuid, p_lat double precision, p_lng double precision, p_seen_at timestamptz,
  p_note text, p_contact_name text, p_contact text, p_photo text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from reports where id = p_report_id and status = 'lost') then
    raise exception 'Sightings can only be added to lost dog reports.';
  end if;
  if p_lat is null or p_lng is null then raise exception 'Please set where you saw the dog on the map.'; end if;
  if p_photo is not null and p_photo !~ '^https://[^ ]+/storage/v1/object/public/dog-photos/' then raise exception 'Invalid photo URL.'; end if;
  insert into sightings (report_id, lat, lng, seen_at, note, contact_name, contact, photo)
  values (p_report_id, p_lat, p_lng, least(coalesce(p_seen_at, now()), now() + interval '1 day'),
          left(btrim(coalesce(p_note, '')), 600), left(btrim(coalesce(p_contact_name, '')), 80),
          left(btrim(coalesce(p_contact, '')), 120), p_photo)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.reunite_report(p_id uuid, p_owner_token text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  if not exists (select 1 from reports where id = p_id) then raise exception 'Report not found.'; end if;
  select owner_token_hash into v_hash from report_owner_keys where report_id = p_id;
  -- Reports with no owner key (e.g. samples you insert by hand) can be marked by anyone
  if v_hash is not null and v_hash <> encode(extensions.digest(coalesce(p_owner_token, ''), 'sha256'), 'hex') then
    raise exception 'Only the person who filed this report can mark it reunited (owner key required).';
  end if;
  update reports set reunited = true, reunited_at = now() where id = p_id;
  return true;
end $$;

revoke all on function public.create_report(text, text, text, text, text, text, timestamptz, double precision, double precision, text, text, text, text, uuid) from public;
revoke all on function public.add_sighting(uuid, double precision, double precision, timestamptz, text, text, text, text) from public;
revoke all on function public.reunite_report(uuid, text) from public;
grant execute on function public.create_report(text, text, text, text, text, text, timestamptz, double precision, double precision, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.add_sighting(uuid, double precision, double precision, timestamptz, text, text, text, text) to anon, authenticated;
grant execute on function public.reunite_report(uuid, text) to anon, authenticated;

-- ---------- photo storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dog-photos', 'dog-photos', true, 6291456, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket = anyone can view photos by URL. Allow uploads (new files only) into this bucket.
drop policy if exists "Anyone can upload dog photos" on storage.objects;
create policy "Anyone can upload dog photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'dog-photos');

-- Make the new tables visible to the REST API right away
notify pgrst, 'reload schema';
