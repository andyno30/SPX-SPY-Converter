import { createAuthorizer } from './authorization.ts';
import { createHandler } from './handler.ts';
import { createSnapshotReader, type SnapshotRecord } from './snapshot.ts';

export type AccessSnapshot = SnapshotRecord & { is_subscribed: boolean };

// Share the result only within one HTTP request. Identity and subscription are
// checked again on every GET, including concurrent requests and revoked users.
export function createRequestHandler(deps: {
  userId: (token: string) => Promise<string | null>;
  readAccessSnapshot: (id: string) => Promise<unknown>;
  now?: () => number;
}) {
  return (req: Request): Promise<Response> => {
    let record: AccessSnapshot | null = null;
    const authorize = createAuthorizer({
      userId: deps.userId,
      async subscribed(id) {
        const value = await deps.readAccessSnapshot(id);
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            !('is_subscribed' in value) || typeof value.is_subscribed !== 'boolean') {
          throw new Error('Subscription and price snapshot lookup failed');
        }
        record = value as AccessSnapshot;
        return record.is_subscribed;
      },
    });
    return createHandler({
      authorize,
      snapshot: createSnapshotReader(async () => record, deps.now),
      now: deps.now,
    })(req);
  };
}
