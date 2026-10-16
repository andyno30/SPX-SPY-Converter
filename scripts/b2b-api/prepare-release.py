"""Prepare an isolated release workspace and private credentials, never deploy.

Credentials and generated credential SQL stay outside Git with owner-only access.
Reuses an existing credential file on retry. Never prints secret material.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('/private/tmp/spyconverter-b2b-release')
OUT.mkdir(mode=0o700, exist_ok=True)
os.chmod(OUT, 0o700)
credentials = OUT / 'credentials.json'
if credentials.exists():
    values = json.loads(credentials.read_text())
else:
    values = {key: secrets.token_hex(32) for key in [
        'B2B_DB_BACKEND_PASSWORD', 'B2B_DB_SOURCE_PASSWORD', 'B2B_DB_WRITER_PASSWORD',
        'B2B_API_KEY_PEPPER', 'B2B_GATEWAY_SECRET',
    ]}
    credentials.write_text(json.dumps(values))
    os.chmod(credentials, 0o600)

def scram(password):
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 4096)
    client = hmac.new(salted, b'Client Key', hashlib.sha256).digest()
    stored = hashlib.sha256(client).digest()
    server = hmac.new(salted, b'Server Key', hashlib.sha256).digest()
    b64 = lambda data: base64.b64encode(data).decode()
    return f'SCRAM-SHA-256$4096:{b64(salt)}${b64(stored)}:{b64(server)}'

sql = ['begin;']
for filename in ['b2b_api_setup.sql', 'b2b_api_review.sql', 'b2b_api_source_reader.sql', 'b2b_api_signing.sql']:
    body = (ROOT / 'supabase/sql' / filename).read_text()
    sql.append(re.sub(r'^(?:begin|commit);\s*$', '', body, flags=re.M))
for role, group in [('backend','b2b_backend'),('source','b2b_source_reader'),('writer','b2b_cache_writer')]:
    login = f'b2b_{role}_login'
    sql.append(f"create role {login} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit {20 if role == 'backend' else 12} password '{scram(values[f'B2B_DB_{role.upper()}_PASSWORD'])}';")
    sql.append(f'grant {group} to {login}; grant usage on schema public to {login};')
sql.append('commit;')
migrations = OUT / 'supabase/migrations'
migrations.mkdir(parents=True, exist_ok=True)
migration = migrations / '20261016160000_b2b_platform.sql'
migration.write_text('\n'.join(sql))
os.chmod(migration, 0o600)
shutil.copyfile(ROOT / 'supabase/config.toml', OUT / 'supabase/config.toml')
(OUT / 'supabase/.temp').mkdir(exist_ok=True)
for filename in ['project-ref','pooler-url','postgres-version']:
    source = ROOT / 'supabase/.temp' / filename
    if source.exists(): shutil.copyfile(source, OUT / 'supabase/.temp' / filename)

settings = {
    **values,
    'B2B_API_ENVIRONMENT': 'production',
    'B2B_API_SITE_ORIGIN': 'https://spyconverter.com',
    'B2B_SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_f5EYFGZ8NNT7dczGGyBnCA_T1uOvDaf',
    'B2B_API_LIVE_MARKET_DATA_ENABLED': 'false',
    'B2B_API_DATA_LICENSE_APPROVED': 'false',
    'B2B_API_CACHE_COPY_ENABLED': 'false',
    'B2B_API_SYNTHETIC_TEST_MODE': 'false',
    'B2B_API_STRIPE_TEST_ENABLED': 'false',
    'B2B_API_STRIPE_LIVE_ENABLED': 'false',
    'B2B_API_LEGAL_APPROVED': 'false',
}
envfile = OUT / 'b2b.env'
envfile.write_text(''.join(f'{key}={value}\n' for key,value in settings.items()))
os.chmod(envfile, 0o600)
print(f'Prepared isolated release in {OUT}; no secrets printed; no deployment performed.')
