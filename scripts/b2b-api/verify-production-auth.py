"""Verify real Supabase identity + B2B org isolation using two disposable test users.

Creates only new @example.test users, sends no emails, never prints credentials.
Private test identifiers/credentials stay in an owner-only temporary file for cleanup.
No market-data endpoint, checkout or existing customer record is invoked.
"""
import json, os, secrets, subprocess, urllib.request, urllib.error
from pathlib import Path
ROOT = Path('/private/tmp/spyconverter-b2b-release')
REF = 'isvzhpqrmjtqnqyyidxr'
BASE = f'https://{REF}.supabase.co'
API = BASE + '/functions/v1/b2b-platform'
PUBLIC = 'sb_publishable_f5EYFGZ8NNT7dczGGyBnCA_T1uOvDaf'
def call(url, method='GET', data=None, headers=None):
    request=urllib.request.Request(url, method=method, headers={'Content-Type':'application/json',**(headers or {})}, data=None if data is None else json.dumps(data).encode())
    try:
        with urllib.request.urlopen(request, timeout=30) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
path=ROOT/'auth-test-users.json'
if path.exists():
    users=json.loads(path.read_text())
else:
    keys=json.loads(subprocess.check_output(['supabase','projects','api-keys','--project-ref',REF,'--output','json'],stderr=subprocess.DEVNULL))
    admin=next(x['api_key'] for x in keys if x['name']=='service_role')
    users=[]
    for label in ('owner','stranger'):
        email=f'b2b-verification-{label}-{secrets.token_hex(5)}@example.test'; password=secrets.token_urlsafe(32)
        status,user=call(BASE+'/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True,'app_metadata':{'b2b_disposable_verification':True}}, {'apikey':admin,'Authorization':'Bearer '+admin})
        if status not in (200,201):raise RuntimeError('Disposable identity setup failed: '+str(status))
        users.append({'id':user['id'],'email':email,'password':password})
        path.write_text(json.dumps(users));os.chmod(path,0o600)
    admin=None;keys=None
for user in users:
    status,session=call(BASE+'/auth/v1/token?grant_type=password','POST',{'email':user['email'],'password':user['password']},{'apikey':PUBLIC})
    assert status==200,'Real Supabase login failed'
    user['token']=session['access_token']
    h={'Authorization':'Bearer '+user['token']}
    status,organizations=call(API+'/platform/organizations',headers=h);assert status==200
    if not organizations['organizations']:
        status,result=call(API+'/platform/organizations','POST',{'name':'B2B disposable integration verification','legal_name':'Synthetic integration fixture','email':user['email'],'intended_use':'Automated authenticated organization-isolation test; no billing or data access.','plan':'developer'},h)
        assert status==201,'Real organization creation failed: '+str(status)
        user['organization_id']=result['organization']['id']
    else:user['organization_id']=organizations['organizations'][0]['id']
    path.write_text(json.dumps(users));os.chmod(path,0o600)
status,result=call(API+'/platform/dashboard?organization_id='+users[0]['organization_id'],headers={'Authorization':'Bearer '+users[0]['token']});assert status==200 and result['role']=='owner'
status,result=call(API+'/platform/dashboard?organization_id='+users[0]['organization_id'],headers={'Authorization':'Bearer '+users[1]['token']});assert status==403,'Cross-organization data isolation failed'
status,result=call(API+'/platform/organizations',headers={'Authorization':'Bearer invalid'});assert status==401
print(json.dumps({'real_supabase_sign_in':True,'real_b2b_organization_creation':True,'owner_dashboard':200,'cross_organization_dashboard':403,'invalid_session':401,'paid_checkout_created':False,'market_data_requests':0}))
