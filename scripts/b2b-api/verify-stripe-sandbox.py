"""Explicit Stripe TEST lifecycle checks. Private fixtures stay outside Git.

Requires the disposable organization setup and hosted test Checkout completion.
Never accepts a live key or edits an existing customer's subscription.
"""
import json, os, sys, urllib.request, urllib.error, urllib.parse
from pathlib import Path
root=Path('/private/tmp/spyconverter-b2b-release')
settings=dict(line.split('=',1) for line in (root/'stripe-test.env').read_text().splitlines() if '=' in line)
key=settings['B2B_TEST_STRIPE_SECRET_KEY'];assert key.startswith(('sk_test_','rk_test_'))
fixtures=json.loads((root/'integration-orgs.json').read_text());users=json.loads((root/'auth-test-users.json').read_text());gateway=json.loads((root/'credentials.json').read_text())['B2B_GATEWAY_SECRET']
base='https://isvzhpqrmjtqnqyyidxr.supabase.co/functions/v1/b2b-platform-test'
def stripe(path,data=None):
 req=urllib.request.Request('https://api.stripe.com/v1/'+path,headers={'Authorization':'Bearer '+key,'Stripe-Version':'2024-06-20'},data=None if data is None else urllib.parse.urlencode(data).encode())
 with urllib.request.urlopen(req,timeout=30) as r:result=json.load(r)
 assert result.get('livemode',False)==False
 return result
def app(f,path,data=None):
 user=next(u for u in users if u['id']==f['user_id'])
 req=urllib.request.Request(base+path,headers={'Authorization':'Bearer '+user['token'],'X-B2B-Gateway':gateway,'Content-Type':'application/json'},data=None if data is None else json.dumps(data).encode())
 with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
f=fixtures[0];state=app(f,'/platform/dashboard?organization_id='+f['organization_id']);sub=stripe('subscriptions/'+state['subscription']['stripe_subscription_id']);assert sub['metadata']['namespace']=='b2b_api' and sub['metadata']['organization_id']==f['organization_id'];customer=stripe('customers/'+sub['customer']);assert customer['test_clock'];clock=stripe('test_helpers/test_clocks/'+customer['test_clock'])
phase=sys.argv[1] if len(sys.argv)>1 else 'status'
if phase=='status':
 print(json.dumps({'stripe_status':sub['status'],'app_status':state['subscription']['status'],'cancel_at_period_end':state['subscription']['cancel_at_period_end'],'period_start':state['subscription']['period_start'],'period_end':state['subscription']['period_end'],'paid_through':state['subscription']['paid_through'],'clock_status':clock['status'],'clock_time':clock['frozen_time'],'invoice_status':stripe('invoices/'+sub['latest_invoice'])['status']}))
elif phase=='advance-renewal':
 assert sub['cancel_at_period_end'] and state['subscription']['cancel_at_period_end'] and state['subscription']['status']=='active'
 f['first_period_end']=sub['current_period_end'];sub=stripe('subscriptions/'+sub['id'],{'cancel_at_period_end':'false'});stripe('test_helpers/test_clocks/'+clock['id']+'/advance',{'frozen_time':sub['current_period_end']+3600});print('Cancellation preserved paid access; test clock advancing to renewal.')
elif phase=='verify-renewal':
 assert clock['status']=='ready';invoice=stripe('invoices/'+sub['latest_invoice'])
 if invoice['status']=='draft':
  stripe('invoices/'+invoice['id']+'/finalize',{});print('Finalized TEST renewal invoice; awaiting Stripe payment/webhook.')
 else:
  assert invoice['paid'] and invoice['status']=='paid' and sub['current_period_start']==f['first_period_end'];assert state['subscription']['status']=='active' and state['subscription']['period_start']==__import__('datetime').datetime.fromtimestamp(sub['current_period_start'],__import__('datetime').timezone.utc).isoformat()
  print('Real TEST renewal payment and application billing-period transition: PASS')
elif phase=='advance-failure':
 method=stripe('payment_methods/pm_card_chargeCustomerFail/attach',{'customer':customer['id']});stripe('subscriptions/'+sub['id'],{'default_payment_method':method['id']});stripe('test_helpers/test_clocks/'+clock['id']+'/advance',{'frozen_time':sub['current_period_end']+3600});print('Test clock advancing with a Stripe failure fixture; no real payment method.')
elif phase=='verify-failure':
 invoice=stripe('invoices/'+sub['latest_invoice'])
 if invoice['status']=='draft':stripe('invoices/'+invoice['id']+'/finalize',{});print('Finalized TEST failure invoice; awaiting payment failure webhook.')
 else:
  assert sub['status']=='past_due' and state['subscription']['status']=='past_due';print('Real TEST failed renewal revokes entitlement: PASS')
elif phase=='cancel':
 stripe('subscriptions/'+sub['id'],{'cancel_at_period_end':'true'});stripe('test_helpers/test_clocks/'+clock['id']+'/advance',{'frozen_time':sub['current_period_end']+1});print('Test clock advancing to scheduled termination.')
elif phase=='verify-cancel':
 assert sub['status']=='canceled' and state['subscription']['status']=='canceled';print('Real TEST scheduled termination reaches application: PASS')
else:raise ValueError('Unknown verification phase')
(root/'integration-orgs.json').write_text(json.dumps(fixtures));os.chmod(root/'integration-orgs.json',0o600)
