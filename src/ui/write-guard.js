export function canMutate({ demoMode, repository, offlineReadOnly }) {
  if (demoMode) return true;
  return Boolean(repository) && !offlineReadOnly;
}
