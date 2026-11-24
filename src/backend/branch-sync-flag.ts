// branch-sync-flag.ts — is the open project's branch set kept as server
// records (branch-sync.ts)? A module of its own so autosave can ask without
// importing the sync (and the editor modules it pulls in).

let active = false;

export function setServerBranchSyncActive(next: boolean): void {
  active = next;
}

/** True while branches are server records: envelope saves then carry main only. */
export function isServerBranchSyncActive(): boolean {
  return active;
}
