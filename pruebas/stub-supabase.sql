-- Imita lo mínimo de Supabase (roles, auth.users, auth.uid) para instalar cil.sql en un Postgres de prueba.
do $$ begin create role authenticated; exception when others then null; end $$;
do $$ begin create role anon; exception when others then null; end $$;
do $$ begin create role service_role; exception when others then null; end $$;
create schema auth; create schema extensions;
create table auth.users(instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz, confirmation_token text, recovery_token text, email_change_token_new text, email_change text);
create table auth.identities(id uuid primary key, user_id uuid, provider_id text, provider text, identity_data jsonb, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid);
create table auth.refresh_tokens(id serial, user_id varchar(255));
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
