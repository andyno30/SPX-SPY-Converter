import { parseContract, priceResponse, type Snapshot } from './pricing.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'private, no-store',
  'Vary': 'Authorization',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
export type Access = 'allowed' | 'unauthorized' | 'forbidden';
export function createHandler(deps: {
  authorize: (token: string) => Promise<Access>;
  snapshot: () => Promise<Snapshot>;
  now?: () => number;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET') return json({ message: 'Method not allowed' }, 405);
    const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return json({ message: 'Sign in to access Pro prices.' }, 401);
    try {
      // Authorize every request, including cache hits, before reading market data.
      const access = await deps.authorize(token);
      if (access === 'unauthorized') return json({ message: 'Your session has expired.' }, 401);
      if (access !== 'allowed') return json({ message: 'An active Pro subscription is required.' }, 403);
      const contract = parseContract(req.url);
      if (!contract) return json({ message: 'Invalid ES contract.' }, 400);
      const data = priceResponse(await deps.snapshot(), contract, deps.now?.());
      if (!data) return json({ code: 'es_contract_unavailable', message: 'This ES contract is currently unavailable. Choose another contract or Auto.' }, 503);
      return json(data);
    } catch {
      console.error('get-live-price-pro: authorization or quote lookup failed');
      return json({ message: 'Unable to refresh Pro prices. Please try again.' }, 503);
    }
  };
}
