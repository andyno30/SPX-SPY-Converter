// Reuse the actual response builder. Never fork or approximate its JSON contract.
import { priceResponse, ES_CONTRACTS, type Snapshot } from '../functions/get-live-price-pro/pricing.ts';
import { createSnapshotReader } from '../functions/get-live-price-pro/snapshot.ts';
import { sha256, requireValue } from './core.mjs';

export type CachedBody = {
  mode: 'test'|'live'; selection: string; body: string; digest: string;
  source_fetched_at: string; copied_at: string; evaluation_day: string;
  provenance: 'synthetic'|'licensed'; license_reference: string|null;
};
// This module has NO network dependency and NO provider/updater capability.
// Source is one atomic quotes+fetched_at record, already fetched by the original backend.
export async function materialize(record: {quotes: unknown; fetched_at: unknown}, now: number, provenance: 'synthetic'|'licensed', licenseReference: string|null=null): Promise<CachedBody[]> {
  requireValue(provenance==='synthetic'||(provenance==='licensed'&&licenseReference),503,'license_required','A documented license is required.');
  const snapshot: Snapshot=await createSnapshotReader(async()=>record,()=>now)();
  const results: CachedBody[]=[];
  for(const selection of ['AUTO',...ES_CONTRACTS.map(c=>c.contract)]){
    const value=priceResponse(snapshot,selection,now);
    if(!value)continue;
    const body=JSON.stringify(value);
    results.push({mode:provenance==='synthetic'?'test':'live',selection,body,digest:await sha256(body),source_fetched_at:snapshot.fetchedAt,copied_at:new Date(now).toISOString(),evaluation_day:new Date(now).toISOString().slice(0,10),provenance,license_reference:licenseReference});
  }
  return results;
}
export async function synchronize(readSource:()=>Promise<{quotes:unknown;fetched_at:unknown}>,publish:(rows:CachedBody[])=>Promise<unknown>,now:number,provenance:'synthetic'|'licensed',reference:string|null=null){
  // Called only by a cache-copy timer, never by the customer request handler.
  // A failed copy leaves the last successful body intact; serving still applies source TTL.
  const rows=await materialize(await readSource(),now,provenance,reference);
  await publish(rows);
  return rows[0].digest;
}
