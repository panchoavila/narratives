// linked-remote-store.ts — a local site that is a working copy of a server
// project (`sites/<id>/_revyme/remote.json`, written by `site:pull` /
// `branch:push`). Its edits reach the server only as a branch the owner
// applies there (briefs/22-11-2026-branch-review-workflow.md, D5), so the
// editor says so and keeps local branches out of the way.

import { atom } from 'jotai';

export interface LinkedRemote {
  url: string;
  siteId: string;
  branch: string | null;
}

export const linkedRemoteAtom = atom<LinkedRemote | null>(null);
