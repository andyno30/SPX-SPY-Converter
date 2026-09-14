import type { Access } from './handler.ts';

// Keep the existing Supabase user identity + profiles.is_subscribed architecture.
// Dependencies expose only the two reads needed, making fail-closed behavior testable.
export function createAuthorizer(deps: {
  userId: (token: string) => Promise<string | null>;
  subscribed: (id: string) => Promise<boolean>;
}) {
  return async (token: string): Promise<Access> => {
    const id = await deps.userId(token);
    if (!id) return 'unauthorized';
    return await deps.subscribed(id) === true ? 'allowed' : 'forbidden';
  };
}
