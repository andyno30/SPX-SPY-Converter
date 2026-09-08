import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Vercel: 0 cancels a build, 1 builds. Unknown history always builds.
const cwd = fileURLToPath(new URL('..', import.meta.url));
const before = process.env.VERCEL_GIT_PREVIOUS_SHA;
const after = process.env.VERCEL_GIT_COMMIT_SHA;
if (!before || !after || !/^[a-f0-9]{40}$/.test(before) || !/^[a-f0-9]{40}$/.test(after)) {
  console.log('Build: no trustworthy previous deployment commit.');
  process.exit(1);
}
const diff = spawnSync('git', ['diff', '--quiet', before, after, '--', '.'], {cwd});
console.log(diff.status === 0 ? 'Skip: game-app is unchanged.' : 'Build: game-app changed or history unavailable.');
process.exit(diff.status === 0 ? 0 : 1);
