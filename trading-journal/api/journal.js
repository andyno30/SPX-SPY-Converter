import { journalRequest } from '../lib/publisher.js';

export default { fetch: request => journalRequest(request) };
