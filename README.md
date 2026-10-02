# Reading

Reading is a deliberately lightweight personal book tracker modeled on Watching.

Version: **0.1.4**

## Core structure

- **Now Reading**
  - Fiction
  - Nonfiction
- **Queued Up**
  - Fiction
  - Nonfiction
- **Archive**
  - Fiction
  - Nonfiction

Books are manually ordered by drag. There is no alternate sort mode.

Each row shows title, author, first-publication year, and a labelled Book Marks or Amazon.ca link when available.

Expanding a book can show:
- cached **About** text
- cached **Critical Reception** with short, attributed professional-review excerpts

## Nonfiction view

The bottom-right Brain button is a presentation-only filter. It hides Fiction without changing stored order or category. It also works in Archive.

## Backend

Reading is designed to share the existing **Ticking** Supabase project:

- project ref: `appesztafatypbxzdunr`
- region: `ca-central-1`

Reading uses its own isolated namespace:
- `reading_access`
- `reading_books`

The Reading schema was applied to the shared Ticking project on **October 2, 2026**. Both Reading tables have RLS enabled, `anon` access revoked, and explicit `authenticated` grants. The same account already authorized for Watching was added to `reading_access`.

## Authentication

Email + password with persistent Supabase sessions, matching Watching.

## Metadata

Apple Books, Google Books, and Open Library are searched together and deduplicated. Apple Books improves coverage of current commercial releases, while Google Books and Open Library supplement ISBNs and metadata. Weak title/author matches are suppressed. Title-only records are merged with matching expanded title/subtitle records from another provider when author and publication year agree, so subtitles are preserved whenever a source supplies them. Descriptions are cached when a book is added. Manual entry remains available when metadata lookup is unavailable.

Critical Reception is resolved server-side by the authenticated `reading-reception` Edge Function. It first tries Book Marks by known URL, title-derived URL, and title/author search. Independent review lookup then tries Kirkus by title and author, Publishers Weekly when an ISBN is known, and title/author web discovery across established review outlets. Each candidate page must identify the requested book and author. Publisher praise remains a final fallback when supported. Up to three short attributed excerpts are cached on the Reading book record. Empty results are not cached, and blocked or failed sources return a retryable error instead of claiming no reviews exist. Independent excerpts include their own review links. Successful Book Marks matches also replace the row's Amazon fallback link with the Book Marks page.

## Local/demo mode

No build step is required.

```bash
python3 -m http.server 4173
```

Open:

```text
http://localhost:4173/?demo=1
```

## Tests

```bash
node --test
```

## Database migrations

Applied migrations:

- `20261002140619_create_reading_tables.sql`
- `20261002140656_authorize_reading_user.sql`
- `20261002150600_reading_v011_googlebooks_metadata_source.sql`
- `20261002152900_reading_v012_applebooks_metadata_source.sql`
- `20261002154200_reading_v014_critical_reception_cache.sql`

Supabase's post-change security advisor reported no Reading-specific security findings. Existing project-wide advisories for other apps/settings are unchanged.

## Deployment target

Repository: `mojocolony/reading`

Production URL: `https://mojocolony.github.io/reading/`
