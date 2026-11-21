/** Source namespaces understood by local authoring and portable exports. */
export const ADDITIONAL_SOURCE_DIRECTORIES = new Set(['lib', 'src', 'styles']);
export const PROJECT_CONFIG_FILES = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'next.config.mjs', 'next.config.js', 'next.config.ts', 'next-env.d.ts',
  'tsconfig.json', 'jsconfig.json', 'postcss.config.mjs', 'postcss.config.js', 'postcss.config.cjs',
  'tailwind.config.js', 'tailwind.config.ts', 'middleware.ts', 'middleware.js',
  'instrumentation.ts', 'instrumentation.js', 'vercel.json',
]);
export const SOURCE_FILE_CONTRACT_PATH = '_meta/source-file-contract.json';
export const SOURCE_FILE_CONTRACT = JSON.stringify({ version: 1 });

export function isAdditionalProjectSourcePath(path: string): boolean {
  return PROJECT_CONFIG_FILES.has(path) || ADDITIONAL_SOURCE_DIRECTORIES.has(path.split('/')[0] ?? '');
}

/** The marker travels through ProjectFS, including branches and old-tab saves. */
export function understandsAdditionalSourceFiles(files: Readonly<Record<string, string>>): boolean {
  try { return JSON.parse(files[SOURCE_FILE_CONTRACT_PATH] ?? '{}').version === 1; } catch { return false; }
}
