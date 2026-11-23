import { catalogTargetOf, catalogTargetQuery } from '@/lib/catalog-target';
import { proxyJson } from '@/lib/ui/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const query = catalogTargetQuery(catalogTargetOf(params));
  return proxyJson('GET', `/api/backends/catalog${query ? `?${query}` : ''}`);
}
