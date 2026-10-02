import { normalizeBook } from '../domain/books.js';

function nowIso() {
  return new Date().toISOString();
}

function throwIf(error) {
  if (error) throw error;
}

export function mapDbBook(row) {
  return normalizeBook({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    author: row.author,
    publicationYear: row.publication_year,
    isbn13: row.isbn13,
    status: row.status,
    category: row.category,
    sortOrder: row.sort_order,
    description: row.description,
    metadataSource: row.metadata_source,
    metadataSourceId: row.metadata_source_id,
    bookmarksUrl: row.bookmarks_url,
    amazonCaUrl: row.amazon_ca_url,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function toBookInsert(userId, book) {
  return {
    user_id: userId,
    title: book.title,
    author: book.author,
    publication_year: book.publicationYear ?? null,
    isbn13: book.isbn13 ?? null,
    status: book.status,
    category: book.category,
    sort_order: book.sortOrder ?? 0,
    description: book.description ?? null,
    metadata_source: book.metadataSource ?? 'manual',
    metadata_source_id: book.metadataSourceId ?? null,
    bookmarks_url: book.bookmarksUrl ?? null,
    amazon_ca_url: book.amazonCaUrl ?? null,
    finished_at: book.finishedAt ?? null,
  };
}

export function createRepository(client) {
  return {
    async loadBooks(userId) {
      const { data, error } = await client
        .from('reading_books')
        .select('*')
        .eq('user_id', userId)
        .order('sort_order', { ascending: true });
      throwIf(error);
      return (data ?? []).map(mapDbBook);
    },

    async createBook(userId, book) {
      const { data, error } = await client
        .from('reading_books')
        .insert(toBookInsert(userId, book))
        .select()
        .single();
      throwIf(error);
      return mapDbBook(data);
    },

    async updateBook(bookId, patch) {
      const dbPatch = { updated_at: nowIso() };
      if ('title' in patch) dbPatch.title = patch.title;
      if ('author' in patch) dbPatch.author = patch.author;
      if ('publicationYear' in patch) dbPatch.publication_year = patch.publicationYear ?? null;
      if ('isbn13' in patch) dbPatch.isbn13 = patch.isbn13 ?? null;
      if ('status' in patch) dbPatch.status = patch.status;
      if ('category' in patch) dbPatch.category = patch.category;
      if ('sortOrder' in patch) dbPatch.sort_order = patch.sortOrder;
      if ('description' in patch) dbPatch.description = patch.description ?? null;
      if ('metadataSource' in patch) dbPatch.metadata_source = patch.metadataSource ?? 'manual';
      if ('metadataSourceId' in patch) dbPatch.metadata_source_id = patch.metadataSourceId ?? null;
      if ('bookmarksUrl' in patch) dbPatch.bookmarks_url = patch.bookmarksUrl ?? null;
      if ('amazonCaUrl' in patch) dbPatch.amazon_ca_url = patch.amazonCaUrl ?? null;
      if ('finishedAt' in patch) dbPatch.finished_at = patch.finishedAt ?? null;

      const { data, error } = await client
        .from('reading_books')
        .update(dbPatch)
        .eq('id', bookId)
        .select()
        .single();
      throwIf(error);
      return mapDbBook(data);
    },

    async saveBookPlacements(changedBooks) {
      for (const book of changedBooks) {
        const { error } = await client.from('reading_books').update({
          status: book.status,
          category: book.category,
          sort_order: book.sortOrder,
          updated_at: nowIso(),
        }).eq('id', book.id);
        throwIf(error);
      }
    },

    async finishBookRecord(bookId, finishedAt) {
      return this.updateBook(bookId, { status: 'archived', finishedAt });
    },

    async saveResolvedBookMarksUrl(bookId, bookmarksUrl) {
      return this.updateBook(bookId, { bookmarksUrl });
    },

    async deleteBook(bookId) {
      const { error } = await client.from('reading_books').delete().eq('id', bookId);
      throwIf(error);
    },
  };
}
