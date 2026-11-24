/**
 * Who a model catalogue is read for: `GET /api/backends/catalog?project=&agent=`
 * (TODO #531, 5-B). The daemon then leaves out a backend whose reserved key this
 * mission would not receive. A filter, never a right: the spawn decides again.
 *
 * Free of React and of `'use client'`, because the Next route forwards the same
 * two parameters the browser's store keys its cache on.
 */

export type CatalogTarget = {
  project?: string | null;
  agent?: string | null;
  /** The runtime profile (a Hermes profile) the agent editor holds before it is saved, on
   *  its backend: that backend then carries the profile's list. `name: ''` is the default.
   *  Absent: the agent's saved one, read by the daemon. */
  runtimeProfile?: { backend: string; name: string } | null;
};

/** `project=…&agent=…&runtimeProfile=…&runtimeProfileBackend=…`, or `''` for the whole
 *  inventory. Nothing else gets through. */
export function catalogTargetQuery(target: CatalogTarget | null | undefined): string {
  const query = new URLSearchParams();
  const project = target?.project?.trim();
  const agent = target?.agent?.trim();
  if (project) query.set('project', project);
  if (agent) query.set('agent', agent);
  const draft = target?.runtimeProfile;
  if (draft && draft.backend.trim()) {
    query.set('runtimeProfile', draft.name.trim());
    query.set('runtimeProfileBackend', draft.backend.trim());
  }
  return query.toString();
}

/** The `CatalogTarget` a query string of `catalogTargetQuery` came from (the Next route forwards it). */
export function catalogTargetOf(params: URLSearchParams): CatalogTarget {
  const name = params.get('runtimeProfile');
  const backend = params.get('runtimeProfileBackend');
  return {
    project: params.get('project'),
    agent: params.get('agent'),
    ...(name !== null && backend ? { runtimeProfile: { backend, name } } : {}),
  };
}
