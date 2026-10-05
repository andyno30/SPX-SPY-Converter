/// <reference lib="deno.ns" />
// Retired after the website switches to contact-for-licencing. Keep a reversible
// tombstone instead of serving prices or redirecting callers to the new address.
Deno.serve(() => new Response(JSON.stringify({
  message: 'This endpoint has been retired. Please reload Spyconverter Pro.',
}), {
  status: 410,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  },
}));
