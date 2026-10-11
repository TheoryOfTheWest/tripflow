import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

// This stages a reviewed build only. It does not commit, push, or copy user data.
const root = await realpath('.');
const site = await realpath(resolve(process.argv[2] || 'work/personal-site'));
const git = process.env.GIT_EXECUTABLE || 'git';
const run = (args, cwd) => execFileSync(git, args, { cwd, encoding: 'utf8' }).trim();
if (await realpath(run(['rev-parse', '--show-toplevel'], site)) !== site)
  throw new Error('Target must be the root of the personal website repository.');
const remote = run(['remote', 'get-url', 'origin'], site);
if (!/^(https:\/\/github\.com\/|git@github\.com:)TheoryOfTheWest\/TheoryOfTheWest\.github\.io(?:\.git)?$/i.test(remote))
  throw new Error('Unexpected website remote; refusing to stage files.');
const html = await readFile(join(root, 'dist/index.html'), 'utf8');
if (!html.includes('/tripflow/assets/')) throw new Error('Build must use /tripflow/ base path.');
if (run(['status', '--porcelain'], root))
  throw new Error('Commit source changes before staging a release, so sourceCommit matches the build.');
const target = join(site, 'tripflow');
await mkdir(target, { recursive: true });
// Keep previous hashed assets so tabs already open during a deployment still load.
await cp(join(root, 'dist'), target, { recursive: true });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(join(target, 'release.json'), JSON.stringify({
  version: pkg.version,
  sourceRepository: 'https://github.com/TheoryOfTheWest/tripflow',
  sourceCommit: run(['rev-parse', 'HEAD'], root),
  builtAt: new Date().toISOString(),
}, null, 2) + '\n');
console.log(`Staged TripFlow ${pkg.version} at ${target}. Review, commit, and push the website repository to publish.`);