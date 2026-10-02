-- Applied to the shared Ticking Supabase project on 2026-10-02.
create table if not exists public.reading_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.reading_access is 'Reading app only. Allow-list for access inside the shared Ticking Supabase project.';

create table if not exists public.reading_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  author text not null,
  publication_year integer check (publication_year is null or (publication_year > 0 and publication_year < 10000)),
  isbn13 text check (isbn13 is null or isbn13 ~ '^[0-9]{13}$'),
  status text not null check (status in ('now_reading', 'queued', 'archived')),
  category text not null check (category in ('fiction', 'nonfiction')),
  sort_order integer not null default 0,
  description text,
  metadata_source text not null default 'manual' check (metadata_source in ('openlibrary', 'manual')),
  metadata_source_id text,
  bookmarks_url text,
  amazon_ca_url text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.reading_books is 'Reading app only. Tracked active and archived books.';

create index if not exists reading_books_user_status_category_order_idx on public.reading_books (user_id, status, category, sort_order);
alter table public.reading_access enable row level security;
alter table public.reading_books enable row level security;
revoke all on public.reading_access from anon;
revoke all on public.reading_books from anon;
grant select on public.reading_access to authenticated;
grant select, insert, update, delete on public.reading_books to authenticated;

drop policy if exists reading_access_select_self on public.reading_access;
create policy reading_access_select_self on public.reading_access for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists reading_books_select_own on public.reading_books;
create policy reading_books_select_own on public.reading_books for select to authenticated using ((select auth.uid()) = user_id and exists (select 1 from public.reading_access ra where ra.user_id = (select auth.uid())));

drop policy if exists reading_books_insert_own on public.reading_books;
create policy reading_books_insert_own on public.reading_books for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.reading_access ra where ra.user_id = (select auth.uid())));

drop policy if exists reading_books_update_own on public.reading_books;
create policy reading_books_update_own on public.reading_books for update to authenticated using ((select auth.uid()) = user_id and exists (select 1 from public.reading_access ra where ra.user_id = (select auth.uid()))) with check ((select auth.uid()) = user_id and exists (select 1 from public.reading_access ra where ra.user_id = (select auth.uid())));

drop policy if exists reading_books_delete_own on public.reading_books;
create policy reading_books_delete_own on public.reading_books for delete to authenticated using ((select auth.uid()) = user_id and exists (select 1 from public.reading_access ra where ra.user_id = (select auth.uid())));
