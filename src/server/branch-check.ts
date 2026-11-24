// branch-check.ts — the server's check of files an agent proposes for a
// branch (briefs/22-11-2026-branch-review-workflow.md, D4–D6).
//
// Early feedback for the agent, before anything is stored, limited to what it
// changed:
//   · every changed TS/TSX file parses;
//   · the whole proposed site keeps the CMS contract (schemas, data ↔ schema,
//     views ↔ schema, SEO bindings).
// The oracle runs on the agent's side before it writes (branch-oracle-check.ts,
// in the CLI and narratives-mcp bundles: it needs the editor's parser, which
// the server bundle does not carry), and the editor's full gate runs when the
// owner applies the branch.

import { parse } from '@babel/parser';
import { validateFullCmsSite } from '../shared/cms-site-contract';

/**
 * Problems with `proposed` (the branch's full website after the change), one
 * line each, or an empty list.
 */
export function checkProposedFiles(
  proposed: Record<string, string>,
  changed: string[],
): string[] {
  const problems: string[] = [];

  for (const relPath of changed) {
    const code = proposed[relPath];
    if (code === undefined || !/\.(tsx?|jsx?)$/.test(relPath)) continue;
    try {
      parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    } catch (err) {
      problems.push(`${relPath}: syntax error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (problems.length > 0) return problems;

  const { issues } = validateFullCmsSite(proposed);
  for (const issue of issues) problems.push(`[${issue.code}] ${issue.message}`);

  return problems;
}
