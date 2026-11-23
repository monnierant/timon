import { proxyJson } from '@/lib/ui/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The runtime profiles (Hermes profiles) a backend's program has on this host: `{ label, names }`, 404 for none. */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  return proxyJson('GET', `/api/backends/${encodeURIComponent(params.id)}/runtime-profiles`);
}
