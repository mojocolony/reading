# Reading

Reading is a deliberately lightweight personal book tracker modeled on Watching.

Version: **0.1.9**

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

Email + password with persistent Supabase sessions, matching Watching. Sign-in failures distinguish rejected credentials, connection problems, throttling, and failures loading Reading after a successful sign-in. Raw errors are never shown.

## Metadata

Apple Books, Google Books, and Open Library are searched together and deduplicated. Apple Books improves coverage of current commercial releases, while Google Books and Open Library supplement ISBNs and metadata. Weak title/author matches are suppressed. Title-only records are merged with matching expanded title/subtitle records from another provider when author and publication year agree, so subtitles are preserved whenever a source supplies them. Descriptions are cached when a book is added. Manual entry remains available when metadata lookup is unavailable.

Critical Reception is resolved server-side by the authenticated `reading-reception` Edge Function. Direct Book Marks, Kirkus and Publishers Weekly candidates are supplemented by one Tavily basic search for the full title and author. Returned snippets are never presented as verified reviews: each allowed destination must identify the requested book and author on its own page. Article sidebars and praise for other books are excluded. Up to three distinct outlets provide short evaluative excerpts, with links and explicit labels for publisher-selected praise.

Set `TAVILY_API_KEY` in the Ticking project's **Edge Functions → Secrets** before deploying v0.1.7. The key stays server-side. Basic search uses one credit per uncached lookup; page verification does not use Tavily Extract. Missing configuration, rate limits and inaccessible sources make the lookup incomplete, never an authoritative negative result.

Cache version 3 records normalized title/author identity, completeness and recheck time. Legacy entries are refreshed automatically. Version 3 also refreshes version-2 excerpts after the Trust acceptance check exposed a comparison to an earlier novel. Structured Book Marks credits are parsed separately, and excerpts start with discussion of the requested title when it is named. Complete results expire after seven days; partial results after one day. The **Refresh reviews** control bypasses both positive caches. Empty searches are never persisted, and outages preserve useful saved reception. Database writes check the captured title and author to avoid applying an old lookup after an edit. Browser caches reset when accounts change and respect server expiry.

Authenticated live-app checks verified automatic results for Biological War (three outlets, absent from Book Marks), Trans (two), Rock (three), The American Way of Killing (two, replacing an older thin entry), and Trust (three). Trust was entered through the actual app with no ISBN or source URL, testing a shared short title and missing metadata; the extractor selected Hernan Diaz's book and discovered its Book Marks page. The Trust check exposed a quote about an earlier novel, reproduced in regression tests and corrected before acceptance. Partial-source status and retry controls remain visible when sources fail. No review data was manually inserted. See `docs/superpowers/plans/2026-10-02-reception-v2.md`.

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
npm ci
npm test
```

## Database migrations

Applied migrations:

- `20261002140619_create_reading_tables.sql`
- `20261002140656_authorize_reading_user.sql`
- `20261002150600_reading_v011_googlebooks_metadata_source.sql`
- `20261002152900_reading_v012_applebooks_metadata_source.sql`
- `20261002154200_reading_v014_critical_reception_cache.sql`
- `20261002224436_reading_reception_v2_metadata.sql`

Supabase's post-change security advisor reported no Reading-specific security findings. Existing project-wide advisories for other apps/settings are unchanged.

## Deployment target

Repository: `mojocolony/reading`

Production URL: `https://mojocolony.github.io/reading/`
