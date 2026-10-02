# Reading

Reading is a deliberately lightweight personal book tracker modeled on Watching.

Version: **0.1.2**

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
- Book Marks **Critical Reception** through the official ISBN widget when supported

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

Apple Books, Google Books, and Open Library are searched together and deduplicated. Apple Books improves coverage of current commercial releases, while Google Books and Open Library supplement ISBNs and metadata. Weak title/author matches are suppressed. Subtitles are folded into displayed/stored titles when supplied by the source. Descriptions are cached when a book is added. Manual entry remains available when metadata lookup is unavailable.

Book Marks review content is loaded through its official ISBN-based widget. Reading does not scrape Book Marks.

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

Supabase's post-change security advisor reported no Reading-specific security findings. Existing project-wide advisories for other apps/settings are unchanged.

## Deployment target

Repository: `mojocolony/reading`

Production URL: `https://mojocolony.github.io/reading/`
