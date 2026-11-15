// trace.ts — Server-side trace sink with the same verbs as the editor's
// `@/shared/debug-trace` (action / fn / dom / error). The browser trace keeps
// an in-page ring buffer and DOM observers; on the server every entry is one
// JSON line on stdout (stderr for errors), which journald keeps and greps well.
//
// `TRACE=off` silences action/fn/dom (errors always print).

type TraceType = 'action' | 'fn' | 'dom' | 'error';

const quiet = process.env.TRACE === 'off';

function serialize(data: unknown): unknown {
  if (data instanceof Error) return { name: data.name, message: data.message, stack: data.stack };
  return data;
}

function emit(type: TraceType, category: string, data?: unknown): void {
  if (quiet && type !== 'error') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), type, category, data: serialize(data) });
  if (type === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const trace = {
  action: (category: string, data?: unknown) => emit('action', category, data),
  fn: (category: string, data?: unknown) => emit('fn', category, data),
  dom: (category: string, data?: unknown) => emit('dom', category, data),
  error: (category: string, data?: unknown) => emit('error', category, data),
};
