-- Applied to the shared Ticking Supabase project on 2026-10-02.
-- Reading v0.1.4: cache short attributed critical-reception excerpts on each book.

alter table public.reading_books
  add column if not exists critical_reception jsonb not null default '[]'::jsonb,
  add column if not exists critical_reception_source_url text,
  add column if not exists critical_reception_fetched_at timestamptz;
