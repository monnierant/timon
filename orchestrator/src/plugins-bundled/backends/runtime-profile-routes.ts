/**
 * Runtime profiles over HTTP (`RuntimeProfilesStrategy`): the names a backend's program has on
 * this host, and the model catalogue read for an agent that runs on one. Read-only: the names
 * are folder names, and Timon never writes into a profile.
 */
import type { Request, Router } from 'express';
import { isValidAgentName } from '../../agent-name.js';
import { loadConfig } from '../../agent-config.js';
import { apiError } from '../../api-error.js';
import {
  offersRuntimeProfiles, refreshRuntimeProfileModels, runtimeProfileCatalog, runtimeProfilesOf,
} from '../../backends/catalog.js';

/** A catalogue as `catalogFor` serves it: entries carry more than this, kept as they are. */
type ServedCatalog = { backends: Array<{ id: string; account?: unknown; models: unknown; defaultModel: string | null }> };

/**
 * The runtime profile a catalogue is read for, and on which backend: `?runtimeProfile=` (the
 * agent editor's draft, empty = the default, on `?runtimeProfileBackend=`) wins; otherwise the saved profile of `?agent=`,
 * on that agent's backend. Null: read the backends' own lists, as before.
 */
function wantedRuntimeProfile(req: Request): { name: string; backend: string | null } | null {
  const draft = req.query['runtimeProfile'];
  const agent = req.query['agent'];
  const on = req.query['runtimeProfileBackend'];
  const backend = typeof on === 'string' && on !== '' ? on : null;
  if (typeof draft === 'string') return draft.trim() === '' ? null : { name: draft.trim(), backend };
  if (typeof agent !== 'string' || !isValidAgentName(agent.trim())) return null;
  try {
    const cfg = loadConfig(agent.trim());
    return cfg.runtime_profile ? { name: cfg.runtime_profile, backend: cfg.backend ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * `catalog` with, on each backend that offers runtime profiles (the agent's own when it is
 * known), the list of the wanted profile: every model its agent announced, the ones past the
 * menu's cap marked `searchOnly`, and the model it runs by default. A profile the host does
 * not have, or a probe that fails, leaves the backend's own list.
 */
export async function withRuntimeProfile<C extends ServedCatalog>(catalog: C, req: Request): Promise<C> {
  const wanted = wantedRuntimeProfile(req);
  if (!wanted) return catalog;
  const backends = await Promise.all(catalog.backends.map(async (entry) => {
    if (entry.account || (wanted.backend && entry.id !== wanted.backend) || !offersRuntimeProfiles(entry.id)) return entry;
    try {
      await refreshRuntimeProfileModels(entry.id, wanted.name);
    } catch {
      return entry;
    }
    const own = runtimeProfileCatalog(entry.id, wanted.name);
    if (!own || own.models.length === 0) return entry;
    return { ...entry, models: own.models, defaultModel: own.defaultModel, runtimeProfile: wanted.name };
  }));
  return { ...catalog, backends };
}

export function registerRuntimeProfileRoutes(app: Router): void {
  // What the agent editor offers in its profile field. 404: the backend has none.
  app.get('/api/backends/:id/runtime-profiles', async (req, res) => {
    try {
      const offered = offersRuntimeProfiles(req.params.id) ? await runtimeProfilesOf(req.params.id) : null;
      if (!offered) {
        res.status(404).json(apiError('runtime_profiles_unavailable', `backend ${req.params.id} has no runtime profiles`));
        return;
      }
      res.json(offered);
    } catch (err) {
      res.status(500).json(apiError('runtime_profiles_failed', (err as Error).message));
    }
  });
}
