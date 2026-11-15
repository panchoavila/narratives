import type { LocalPublishingState } from '@/shared/local-publishing';

export async function localPublishingRequest<T = LocalPublishingState>(siteId: string, action = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/publish${action ? `/${action}` : ''}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `Publishing request failed (${response.status}).`);
  return result;
}

/** Publish must use the latest saved source, including a just-committed panel edit. */
export async function prepareLocalPublish(): Promise<void> {
  const { flushNow } = await import('@/code/mutation/mutation-queue');
  flushNow();
  const { upgradePageEffectsForPublish } = await import('@/code/generation/page-transitions-gen');
  upgradePageEffectsForPublish();
  const { projectFS } = await import('@/code/project/project-fs');
  const { buildProvidersSource, looksGeneratedProviders } = await import('@/code/project/providers-gen');
  const providers = projectFS.readFile('app/providers.tsx');
  if (providers && looksGeneratedProviders(providers)) {
    const { getI18nConfig } = await import('@/code/project/locale-ops');
    const { modifyProjectFile } = await import('@/code/project/modify-file');
    const next = buildProvidersSource(getI18nConfig());
    if (providers !== next) modifyProjectFile('app/providers.tsx', () => next);
  }
  const { runPublishPreflight, formatPreflightIssues } = await import('@/code/oracle/publish-preflight');
  const issues = runPublishPreflight();
  if (issues.length) throw new Error(formatPreflightIssues(issues));
  const { flushSaveNow } = await import('@/backend/autosave');
  const saved = await flushSaveNow();
  if (!saved.ok) throw new Error(`Your latest changes could not be saved: ${saved.error}`);
}
