import {deployment} from '../../../deployment';

export const dynamic = 'force-static';
export function GET() {
  return Response.json({status: 'ok', application: 'spyconverter-game', ...deployment});
}
