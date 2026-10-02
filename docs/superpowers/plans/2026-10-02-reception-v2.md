# Critical Reception v2 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task.

**Goal:** Automatically retrieve up to three useful, correctly attributed reviews across real books, including missing ISBNs and books absent from Book Marks.

**Architecture:** Keep the existing authenticated Edge Function and RLS context. Use a configured server-side search API to discover review and publisher URLs, verify identity against the source page, and preserve useful existing results on temporary failure. Version cache metadata separately from review content.

**Tech Stack:** Static JavaScript, Supabase Edge Functions (Deno TypeScript), Postgres JSONB, Node regression tests.

**Spec:** User-approved in-chat design on October 2: reliable search service; meaningful short review excerpts with links; multiple verified sources; replace inadequate caches; actual-app real-book tests without manually inserting reviews.

## Global Constraints
- Preserve existing authentication and row-level security.
- Search credentials remain server-side; never commit them.
- No invented summaries or ratings. Distinguish publisher praise, review extracts, and source-access failures.
- No manual review-data inserts for acceptance tests.
- A missing API key is a setup dependency, not a successful empty search.

## Review Focus
- Ambiguous short titles: compare title and author together.
- Publisher endorsements for earlier books: reject unless identified as the requested title.
- Rate limits or timeouts: keep useful saved reviews, report incomplete lookup, and permit retry.
- Changes to book identity: invalidate both database and browser caches.
- Missing search configuration: do not imply discovery is complete or negative results authoritative.

### Task 1: Search and source extraction
- [x] Add failing tests for reliable search API discovery, malformed/blocked responses, title/author mismatch, and substantive excerpts.
- [x] Replace RSS discovery with a configured API, bounded requests, allowed outlet/publisher destinations, and source-page verification.
- [x] Prefer a meaningful evaluative excerpt from review content over generic social descriptions. Keep direct Kirkus, Book Marks, and supported publisher paths as supplementary sources.
- [x] Run all regression tests.

### Task 2: Versioned cache and failure recovery
- [x] Add failing tests for obsolete/thin cache refresh, identity changes, preservation on partial failure, and a requested refresh.
- [x] Add cache metadata to the existing book table; record version, input fingerprint, completeness, and retry time.
- [x] Save only verified results through the existing user-scoped client. An incomplete lookup cannot overwrite useful content with emptiness.
- [x] Run all regression tests.

### Task 3: Review display and refresh
- [x] Add failing tests for source labels, substantive content, incomplete results, stale memory-cache replacement, and explicit refresh.
- [x] Display each source's review link and clearly label publisher-selected praise. Add a compact retry/refresh control using the authenticated endpoint.
- [x] Verify scripts and run all tests.

### Task 4: Deployment and actual-app acceptance
- [x] Run a fresh code review and resolve important findings.
- [ ] Configure and test the real search provider; deploy only when needed credentials are available.
- [ ] Exercise authenticated actual-app requests for Biological War, a Book Marks book, a missing-ISBN book, an ambiguous-title book, and inaccessible sources.
- [ ] Verify no manual review inserts, live frontend matches, and useful results come from the deployed resolver before claiming completion.

## Verification checkpoint

- Metadata migration applied successfully to Ticking, version `20261002224436`. Existing authentication and RLS remain unchanged; no review data was manually inserted.
- 42 regression tests passed after final review fixes. Syntax and whitespace checks passed.
- Five live source-page checks passed: Biological War at Kirkus and Penguin Random House; Trans by Helen Joyce and Trust by Hernan Diaz at Kirkus; Rock by Chuck Klosterman at Book Marks. This is source-parser validation, not deployed authenticated app acceptance.
- Reviewer findings covered wrong primary title, mixed-book praise, lookup/edit races and synopsis truncation. Regression tests reproduce each issue, and fixes pass.
- User confirmed Tavily server secret saved. Provider integration and authenticated live-app acceptance remain deployment checks.
