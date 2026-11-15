// site-locks.ts — Per-site serialization. Saves (PUT) and the room's
// persistence of live edits both rewrite a site's files; running them one at
// a time per site keeps a save from interleaving with another write.

import { trace } from './trace';

export class SiteLocks {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(siteId: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(siteId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(fn);
    const tail = result.catch((error) => {
      trace.error('site-locks:task-failed', { siteId, error: error instanceof Error ? error.message : String(error) });
    });
    this.tails.set(siteId, tail);
    void tail.then(() => {
      if (this.tails.get(siteId) === tail) this.tails.delete(siteId);
    });
    return result;
  }
}
