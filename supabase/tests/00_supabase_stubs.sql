-- Minimal stand-in for the parts of Supabase the schema relies on.
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  encrypted_password text,
  created_at timestamptz default now(),
  updated_at timestamptz,
  last_sign_in_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create schema extensions;
create extension pgcrypto with schema extensions;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create publication supabase_realtime;
