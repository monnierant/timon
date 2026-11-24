/**
 * Module `@timon/backends` — catalogue of the LLM backends.
 * Tier `core`: without a backend, no mission can be launched.
 *
 * Routes extracted verbatim from `index.ts` (step 1.4). The Ollama Cloud proxy that used to sit here
 * had no caller and belonged to no provider: it went with the volet 5e migration.
 */
import type { Router } from 'express';
import { catalogFor } from './account-routes.js';
import { registerRuntimeProfileRoutes, withRuntimeProfile } from './runtime-profile-routes.js';

export function registerRoutes(app: Router): void {
  // Account instances are filtered by the caller's access list (TODO #52).
  // Read for an agent on a runtime profile (or the editor's draft one), a backend
  // that offers them carries that profile's list (`withRuntimeProfile`).
  app.get('/api/backends/catalog', async (req, res) => {
    try {
      res.json(await withRuntimeProfile(catalogFor(req), req));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  registerRuntimeProfileRoutes(app);
}
