-- Applied to the shared Ticking Supabase project on 2026-10-02.
-- Reading v0.1.2: allow Apple Books as an explicit metadata provenance value.

alter table public.reading_books
  drop constraint if exists reading_books_metadata_source_check;

alter table public.reading_books
  add constraint reading_books_metadata_source_check
  check (metadata_source in ('openlibrary', 'googlebooks', 'applebooks', 'manual'));
