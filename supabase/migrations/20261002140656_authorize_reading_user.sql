-- Applied to the shared Ticking Supabase project on 2026-10-02.
insert into public.reading_access (user_id)
select user_id from public.watching_access
on conflict (user_id) do nothing;
