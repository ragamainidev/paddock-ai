import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedGitEnvironment } from './git-environment';

export type SnapshotManifest = {
  sourceCommit: string;
  files: Array<{ path: string; sha256: string }>;
};

// New data assets must be reviewed and deliberately added here. Source code,
// tests and documentation are exported from the named commit, never the
// working directory. This is a disclosure boundary, not an ownership opinion.
const PUBLIC_DATA = new Set([
  'data/README.md',
  'data/epa-sample.csv',
  'data/epa-sample.provenance.json',
  'data/epa-sample.manifest.json',
  'data/public-generations.json',
  'data/public-generations.provenance.json',
]);
const PRIVATE_PATH =
  /(^|\/)(?:\.git|\.worktrees|node_modules|\.next|\.eve|\.output|\.vercel|release|test-results|playwright-report)(?:\/|$)|(?:^|\/)\.env(?!\.example$)|\.(?:db(?:-(?:wal|shm))?|sqlite3?|pem|key|p12|pfx)$/i;
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const PROVIDER_KEY =
  /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{40,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/;

function validatePath(file: string): void {
  if (file.startsWith('/') || file.split('/').some((part) => part === '..' || part === '.'))
    throw new Error(`Unsafe export path: ${file}`);
  if (PRIVATE_PATH.test(file)) throw new Error(`Private or runtime file is tracked: ${file}`);
  if (file.startsWith('data/') && !PUBLIC_DATA.has(file))
    throw new Error(`Unreviewed data in release commit: ${file}`);
}

export async function exportPublicSnapshot(options: {
  root: string;
  out: string;
  ref?: string;
}): Promise<SnapshotManifest> {
  const out = path.resolve(options.out);
  if (existsSync(out)) throw new Error('Snapshot output already exists; choose a new directory.');
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: options.root,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...isolatedGitEnvironment(), GIT_NO_REPLACE_OBJECTS: '1' },
    });
  const sourceCommit = git(
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${options.ref ?? 'HEAD'}^{commit}`,
  )
    .toString()
    .trim();
  const entries = git('ls-tree', '-rz', '--full-tree', sourceCommit)
    .toString()
    .split('\0')
    .filter(Boolean);
  const files: Array<{ path: string; sha256: string; mode: number; content: Buffer }> = [];
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match)
      throw new Error('Snapshot refuses symlinks and submodules; export regular files only.');
    const [, mode, object, file] = match;
    validatePath(file);
    const content = git('cat-file', 'blob', object);
    const text = content.toString('utf8');
    if (PRIVATE_KEY.test(text)) throw new Error(`Possible private key in ${file}`);
    if (PROVIDER_KEY.test(text)) throw new Error(`Possible provider credential in ${file}`);
    files.push({
      path: file,
      mode: parseInt(mode.slice(-3), 8),
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
  }
  const manifest: SnapshotManifest = {
    sourceCommit,
    files: files.map(({ path: file, sha256 }) => ({ path: file, sha256 })),
  };
  // Validate every blob before creating anything; exclusive creation prevents
  // overwriting user data. Failure cleanup only touches the directory we own.
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out);
  try {
    for (const file of files) {
      const destination = path.join(out, file.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { flag: 'wx', mode: file.mode });
    }
    await writeFile(
      path.join(out, 'release-manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { flag: 'wx' },
    );
  } catch (error) {
    await rm(out, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const out = value('--out');
  if (!out || out.startsWith('--')) {
    console.error('Usage: pnpm release:export --out <new-directory> [--ref <commit>]');
    process.exitCode = 2;
  } else {
    exportPublicSnapshot({ root: process.cwd(), out, ref: value('--ref') })
      .then((manifest) =>
        console.log(
          `Exported ${manifest.files.length} files from ${manifest.sourceCommit} to ${path.resolve(out)}. No Git history or repository settings were copied.`,
        ),
      )
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : 'Snapshot export failed');
        process.exitCode = 1;
      });
  }
}
