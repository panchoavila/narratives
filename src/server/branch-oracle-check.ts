// branch-oracle-check.ts — the oracle over files an agent is about to write
// to a branch (briefs/22-11-2026-branch-review-workflow.md, D5–D6). Runs on
// the agent's side — the CLI (site-cli.ts) and narratives-mcp — because it
// needs the editor's parser; the server checks syntax and the CMS contract
// (branch-check.ts), and the editor's full gate runs at the apply.
//
// Only the files the agent changed are judged, and a violation the same file
// already had in the branch's base is not the agent's to fix.

import { collectCmsDetailRoutes } from '../code/project/cms-detail-route';
import { validateFullCmsSite } from '../shared/cms-site-contract';
import { checkFile, type FileKind } from '../code/oracle/check-file';
import { isCodeComponentSource } from '../code/oracle/checks/shared';

function kindOf(relPath: string, code: string): FileKind | null {
  if (relPath.startsWith('app/') && relPath.endsWith('page.client.tsx')) return 'page';
  if (relPath.startsWith('app/') && relPath.endsWith('LayoutClient.tsx')) return 'template';
  if (relPath.startsWith('components/') && relPath.endsWith('.tsx')) {
    return isCodeComponentSource(code) ? 'code-component' : 'component';
  }
  return null;
}

export function oracleProblems(
  proposed: Record<string, string>,
  base: Record<string, string>,
  changed: string[],
): string[] {
  const problems: string[] = [];
  const { schemas } = validateFullCmsSite(proposed);
  const { schemas: baseSchemas } = validateFullCmsSite(base);
  const cmsRoutes = collectCmsDetailRoutes(proposed);
  const baseRoutes = collectCmsDetailRoutes(base);
  for (const relPath of changed) {
    const code = proposed[relPath];
    if (code === undefined) continue;
    const kind = kindOf(relPath, code);
    if (!kind) continue;
    const had = new Set<string>();
    const before = base[relPath];
    const beforeKind = before !== undefined ? kindOf(relPath, before) : null;
    if (before !== undefined && beforeKind) {
      for (const v of checkFile(before, { kind: beforeKind, path: relPath, schemas: baseSchemas, cmsRoutes: baseRoutes, readProjectFile: (p) => base[p] })) {
        had.add(`${v.code}:${v.message}`);
      }
    }
    for (const v of checkFile(code, { kind, path: relPath, schemas, cmsRoutes, readProjectFile: (p) => proposed[p] })) {
      if (!had.has(`${v.code}:${v.message}`)) problems.push(`[ORACLE:${v.code}] ${relPath}${v.line ? `:${v.line}` : ''} — ${v.message}`);
    }
  }
  return problems;
}
