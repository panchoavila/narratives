import { describe, expect, it } from 'vitest';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { checkFile } from '@/code/oracle/check-file';
import { cmsNavHrefExpr, setCmsNavHrefInCode } from './map-gen';

const PAGE = `'use client';
import Link from 'next/link';
import todo from '@/cms/todo.json';
export default function Page() {
 return <main data-id="root">{todo.map((episode, idx) => (
  <Link data-id="episode" key={idx} href="/todo">Read</Link>
 ))}</main>;
}`;
const navIssues = (code: string) => checkFile(code, {kind:'page'}).filter(issue => issue.code.startsWith('CMS_NAV_'));
describe('CMS navigation fragments', () => {
 it('round-trips an editable section and preserves it when changing the navigation mode', () => {
  const bound = setCmsNavHrefInCode(PAGE, 'episode', 'row', 'todo', 'episode', 'header');
  expect(bound).toContain('data-cms-nav-fragment="header"');
  expect(bound).toContain("href={`/todo/${episode?._slug ?? ''}#header`}");
  expect(parseJSXToNodes(bound).get('episode')?.attrs['data-cms-nav-fragment']).toBe('header');
  expect(navIssues(bound)).toEqual([]);
  const changed = setCmsNavHrefInCode(bound, 'episode', 'row', 'todo', 'episode', 'read');
  expect(changed).toContain("href={`/todo/${episode?._slug ?? ''}#read`}");
  expect(navIssues(changed)).toEqual([]);
  const cleared = setCmsNavHrefInCode(changed, 'episode', 'row', 'todo', 'episode', '');
  expect(cleared).not.toContain('data-cms-nav-fragment');
  expect(cleared).toContain("href={`/todo/${episode?._slug ?? ''}`}");
  expect(navIssues(cleared)).toEqual([]);
  expect(setCmsNavHrefInCode(changed, 'episode', 'none', 'todo', 'episode')).not.toContain('data-cms-nav-fragment');
 });
 it('refuses invalid fragments and oracle rejects mismatched or arbitrary navigation', () => {
  const bound = setCmsNavHrefInCode(PAGE, 'episode', 'row', 'todo', 'episode', 'header');
  expect(setCmsNavHrefInCode(bound, 'episode', 'row', 'todo', 'episode', 'x${evil}')).toBe(bound);
  expect(navIssues(bound.replace('#header', '#other')).map(issue => issue.code)).toContain('CMS_NAV_HREF_MISMATCH');
  expect(navIssues(bound.replace('data-cms-nav-fragment="header"', 'data-cms-nav-fragment="bad name"')).map(issue => issue.code)).toContain('CMS_NAV_INVALID_FRAGMENT');
  expect(cmsNavHrefExpr('todo', '', 'row', 'episode', new Map([['todo','/articles/']]), 'header')).toBe("`/articles/${episode?._slug ?? ''}#header`");
 });
});
