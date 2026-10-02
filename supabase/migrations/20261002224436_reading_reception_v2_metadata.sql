alter table public.reading_books
  add column if not exists critical_reception_meta jsonb;

comment on column public.reading_books.critical_reception_meta is
  'Critical reception lookup version, normalized title/author identity, and source completeness. Null marks legacy results eligible for refresh.';
