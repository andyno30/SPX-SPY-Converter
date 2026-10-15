// Temporary local PostgreSQL only. This helper never accepts a remote DB URL.
// Reproduce on macOS arm64 (installs remain outside the repository):
// npm install --prefix /private/tmp/spy-quota-pg-runtime --cache /private/tmp/spy-quota-pg-runtime-cache --save-exact --ignore-scripts --no-audit --no-fund @embedded-postgres/darwin-arm64@18.4.0-beta.17 pg@8.23.1
// Inspect, then run scripts/hydrate-symlinks.js with cwd set to the installed
// @embedded-postgres/darwin-arm64 package. It creates only package-local links.
// node tests/helpers/premium-quota-postgres-runtime.cjs start
// node --test tests/premium_quota_postgres_test.cjs
// node tests/helpers/premium-quota-postgres-runtime.cjs stop
// Source/provenance: https://github.com/leinelissen/embedded-postgres
// The npm package version includes "beta"; the bundled server reports stable
// PostgreSQL 18.4. No Supabase extensions or production credentials are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const runtimeDir = process.env.SPY_QUOTA_PG_RUNTIME || '/private/tmp/spy-quota-pg-runtime';
const descriptorPath = process.env.SPY_QUOTA_PG_DESCRIPTOR || path.join(runtimeDir, 'active-cluster.json');
const pgModule = path.join(runtimeDir, 'node_modules/pg');
const nativeDir = path.join(runtimeDir, 'node_modules', `@embedded-postgres/${process.platform}-${process.arch}`, 'native');
const binary = name => path.join(nativeDir, 'bin', name);

function loadDescriptor() {
  const d = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  const prefix = path.join(fs.realpathSync(os.tmpdir()), 'spy-qpg-');
  assert.ok(d.root.startsWith(prefix), 'Only the isolated temporary cluster is allowed');
  assert.equal(d.config.host, path.join(d.root, 'socket'));
  assert.equal(d.config.user, 'quota_admin');
  assert.equal(d.config.port, 5432);
  assert.equal(d.dataDir, path.join(d.root, 'data'));
  assert.ok(fs.statSync(d.config.host).isDirectory());
  return d;
}

function getConfig(database = 'postgres') {
  assert.match(database, /^(postgres|spy_quota_[a-z0-9_]+)$/);
  const d = loadDescriptor();
  return { host: d.config.host, port: 5432, user: 'quota_admin', database, connectionTimeoutMillis: 5000 };
}

async function verifyCluster() {
  const { Client } = require(pgModule);
  const d = loadDescriptor();
  const client = new Client(getConfig());
  await client.connect();
  try {
    const result = await client.query("select current_setting('data_directory') as data, current_setting('listen_addresses') as listen, version() as version");
    assert.equal(result.rows[0].data, d.dataDir);
    assert.equal(result.rows[0].listen, '', 'TCP must stay disabled');
    return result.rows[0].version;
  } finally { await client.end(); }
}

async function start() {
  if (fs.existsSync(descriptorPath)) {
    return { descriptorPath, reused: true, version: await verifyCluster() };
  }
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'spy-qpg-'));
  fs.chmodSync(root, 0o700);
  const dataDir = path.join(root, 'data');
  const socket = path.join(root, 'socket');
  fs.mkdirSync(socket, { mode: 0o700 });
  execFileSync(binary('initdb'), ['-D', dataDir, '-U', 'quota_admin', '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), `\nlisten_addresses = ''\nunix_socket_directories = '${socket}'\nunix_socket_permissions = 0700\nmax_connections = 110\nshared_buffers = '16MB'\nlog_statement = 'none'\n`);
  execFileSync(binary('pg_ctl'), ['-D', dataDir, '-l', path.join(root, 'postgres.log'), '-w', 'start'], { stdio: 'pipe' });
  fs.writeFileSync(descriptorPath, JSON.stringify({ root, dataDir, config: { host: socket, port: 5432, user: 'quota_admin', database: 'postgres' } }, null, 2), { mode: 0o600 });
  return { descriptorPath, version: await verifyCluster(), pgModule };
}

async function stop() {
  const d = loadDescriptor();
  await verifyCluster();
  execFileSync(binary('pg_ctl'), ['-D', d.dataDir, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  fs.unlinkSync(descriptorPath);
  fs.rmSync(d.root, { recursive: true });
  return { stopped: true };
}

module.exports = { start, stop, getConfig, verifyCluster, pgModule, descriptorPath };
if (require.main === module) {
  const action = process.argv[2];
  if (!['start', 'stop', 'status'].includes(action)) throw new Error('Usage: node premium-quota-postgres-runtime.cjs start|stop|status');
  (action === 'start' ? start() : action === 'stop' ? stop() : verifyCluster())
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
