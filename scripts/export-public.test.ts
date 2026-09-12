import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { exportPublicSnapshot } from './export-public';
import { isolatedGitEnvironment } from './git-environment';

const roots: string[] = [];
function repository() {
  const root = mkdtempSync(path.join(tmpdir(), 'paddock-export-test-'));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'init.templateDir=',
        ...args,
      ],
      {
        cwd: root,
        stdio: 'pipe',
        env: {
          ...isolatedGitEnvironment(),
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_SYSTEM: '/dev/null',
        },
      },
    );
  git('init', '-q');
  git('config', 'user.name', 'Fixture Author');
  git('config', 'user.email', 'fixture@example.invalid');
  const put = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'fixture');
  };
  put('package.json', '{"name":"fixture"}\n');
  put('src/example.ts', 'export const meaning = 42;\n');
  put('.env.example', 'AI_GATEWAY_API_KEY=\n');
  return { root, git, put, commit };
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('public snapshot export', () => {
  test('exports committed source without history or untracked runtime files', async () => {
    const r = repository();
    r.put('data/epa-sample.csv', 'id,make,model,year\n1,Example,Car,2000\n');
    r.commit();
    r.put('.env.local', 'private-runtime-secret');
    r.put('data/assessments.db', 'private runtime state');
    r.put('src/example.ts', 'uncommitted change');
    const out = path.join(r.root, 'release');
    const manifest = await exportPublicSnapshot({ root: r.root, out });
    expect(readFileSync(path.join(out, 'src/example.ts'), 'utf8')).toContain('meaning = 42');
    expect(existsSync(path.join(out, '.git'))).toBe(false);
    expect(existsSync(path.join(out, '.env.local'))).toBe(false);
    expect(existsSync(path.join(out, 'data/assessments.db'))).toBe(false);
    expect(manifest.files.find((file) => file.path === 'src/example.ts')?.sha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(manifest.sourceCommit).toBe(r.git('rev-parse', 'HEAD').toString().trim());
  });

  test('refuses a release commit containing the original dataset', async () => {
    const r = repository();
    r.put('data/eval-subset.csv', 'unreviewed source');
    r.commit();
    const out = path.join(r.root, 'release');
    await expect(exportPublicSnapshot({ root: r.root, out })).rejects.toThrow(/eval-subset/);
    expect(existsSync(out)).toBe(false);
  });

  test('refuses tracked secrets and private keys without copying any files', async () => {
    const r = repository();
    r.put('.env.production', 'PASSWORD=private');
    r.commit();
    await expect(
      exportPublicSnapshot({ root: r.root, out: path.join(r.root, 'release') }),
    ).rejects.toThrow(/env/);
    r.git('rm', '.env.production');
    r.put('src/key.ts', ['-----BEGIN', 'PRIVATE KEY-----'].join(' ') + '\nsecret\n');
    r.commit();
    await expect(
      exportPublicSnapshot({ root: r.root, out: path.join(r.root, 'release') }),
    ).rejects.toThrow(/private key/i);
    expect(existsSync(path.join(r.root, 'release'))).toBe(false);
  });

  test('refuses unknown data payloads until explicitly reviewed', async () => {
    const r = repository();
    r.put('data/new-vendor.csv', 'unknown license');
    r.commit();
    await expect(
      exportPublicSnapshot({ root: r.root, out: path.join(r.root, 'release') }),
    ).rejects.toThrow(/unreviewed data/i);
  });

  test('never overwrites an existing output directory', async () => {
    const r = repository();
    r.commit();
    const out = path.join(r.root, 'release');
    mkdirSync(out);
    writeFileSync(path.join(out, 'keep.txt'), 'keep');
    await expect(exportPublicSnapshot({ root: r.root, out })).rejects.toThrow(/already exists/);
    expect(readFileSync(path.join(out, 'keep.txt'), 'utf8')).toBe('keep');
  });
});

test('hook Git variables cannot redirect fixture commands or snapshot reads into another repository', async () => {
  const bystander = repository();
  bystander.commit();
  const gitDir = path.join(bystander.root, '.git');
  const before = {
    head: bystander.git('rev-parse', 'HEAD').toString(),
    config: readFileSync(path.join(gitDir, 'config')),
    index: readFileSync(path.join(gitDir, 'index')),
  };
  vi.stubEnv('GIT_DIR', gitDir);
  vi.stubEnv('GIT_WORK_TREE', bystander.root);
  vi.stubEnv('GIT_INDEX_FILE', path.join(gitDir, 'index'));
  vi.stubEnv('GIT_CONFIG_COUNT', '1');
  vi.stubEnv('GIT_CONFIG_KEY_0', 'user.name');
  vi.stubEnv('GIT_CONFIG_VALUE_0', 'Hook Override');
  const intended = repository();
  intended.put('src/example.ts', 'export const intended = true;\n');
  intended.commit();
  const out = path.join(intended.root, 'release');
  const manifest = await exportPublicSnapshot({ root: intended.root, out });
  expect(manifest.sourceCommit).toBe(intended.git('rev-parse', 'HEAD').toString().trim());
  expect(readFileSync(path.join(out, 'src/example.ts'), 'utf8')).toContain('intended = true');
  expect(bystander.git('rev-parse', 'HEAD').toString()).toBe(before.head);
  expect(readFileSync(path.join(gitDir, 'config'))).toEqual(before.config);
  expect(readFileSync(path.join(gitDir, 'index'))).toEqual(before.index);
});
