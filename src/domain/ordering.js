const ACTIVE_STATUSES = new Set(['now_reading', 'queued']);
const CATEGORIES = new Set(['fiction', 'nonfiction']);

function partitionKey(status, category) {
  return `${status}:${category}`;
}

export function normalizeListOrder(books, status, category) {
  if (!ACTIVE_STATUSES.has(status) || !CATEGORIES.has(category)) return books.map(book => ({ ...book }));
  const target = books
    .filter(book => book.status === status && book.category === category)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((book, sortOrder) => ({ ...book, sortOrder }));
  const byId = new Map(target.map(book => [book.id, book]));
  return books.map(book => byId.get(book.id) ?? { ...book });
}

export function moveBook(books, bookId, targetStatus, targetCategory, targetIndex) {
  if (!ACTIVE_STATUSES.has(targetStatus) || !CATEGORIES.has(targetCategory)) return books.map(book => ({ ...book }));
  const moved = books.find(book => book.id === bookId);
  if (!moved || !ACTIVE_STATUSES.has(moved.status) || !CATEGORIES.has(moved.category)) {
    return books.map(book => ({ ...book }));
  }

  const sourceStatus = moved.status;
  const sourceCategory = moved.category;
  const remaining = books.filter(book => book.id !== bookId).map(book => ({ ...book }));
  const targetItems = remaining
    .filter(book => book.status === targetStatus && book.category === targetCategory)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const index = Math.max(0, Math.min(Number.isFinite(targetIndex) ? targetIndex : targetItems.length, targetItems.length));
  targetItems.splice(index, 0, { ...moved, status: targetStatus, category: targetCategory });

  const targetMap = new Map(targetItems.map((book, sortOrder) => [book.id, { ...book, sortOrder }]));
  let next = remaining.map(book => targetMap.get(book.id) ?? book);
  next.push(targetMap.get(moved.id));

  const sourceKey = partitionKey(sourceStatus, sourceCategory);
  const targetKey = partitionKey(targetStatus, targetCategory);

  if (sourceKey !== targetKey) next = normalizeListOrder(next, sourceStatus, sourceCategory);
  next = normalizeListOrder(next, targetStatus, targetCategory);

  return books.map(original => next.find(book => book.id === original.id) ?? { ...original });
}

export function changedPlacements(before, after) {
  const oldById = new Map(before.map(book => [book.id, book]));
  return after.filter(book => {
    const old = oldById.get(book.id);
    return old && (
      old.status !== book.status ||
      old.category !== book.category ||
      Number(old.sortOrder) !== Number(book.sortOrder)
    );
  });
}
