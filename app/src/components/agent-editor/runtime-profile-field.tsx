'use client';

/**
 * The agent's runtime profile: the named home of the program its backend runs on this host
 * (a Hermes profile, `RuntimeProfilesStrategy` on the daemon). The agent's missions run with
 * that home, and its model list is that profile's. Shown only for a backend that has some;
 * empty is the program's default. Timon only names the profile, it never writes into it.
 */
import React, { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { t } from '@/lib/i18n';

/** What `GET /api/ui/backends/runtime-profiles/<id>` answers: the field's name and the host's names. */
export type OfferedRuntimeProfiles = { label: string; names: string[] };

export type RuntimeProfileOption = { value: string; missing: boolean };

/** The default first, the host's names, then a saved name the host no longer has (kept, never swapped). */
export function runtimeProfileOptions(names: readonly string[], value: string): RuntimeProfileOption[] {
  const options = [{ value: '', missing: false }, ...names.map((name) => ({ value: name, missing: false }))];
  return value && !names.includes(value) ? [...options, { value, missing: true }] : options;
}

/** The answer if it has the expected shape, null otherwise (a daemon that does not know the route). */
export function asOffered(body: unknown): OfferedRuntimeProfiles | null {
  const value = body as Partial<OfferedRuntimeProfiles> | null;
  if (!value || typeof value.label !== 'string' || !Array.isArray(value.names)) return null;
  return { label: value.label, names: value.names.filter((name): name is string => typeof name === 'string' && name !== '') };
}

/**
 * The profiles `backend` offers, or null while unknown or when it has none (a 404).
 * Re-read whenever the backend changes.
 */
export function useRuntimeProfiles(backend: string | null | undefined): OfferedRuntimeProfiles | null {
  const [offered, setOffered] = useState<{ backend: string; value: OfferedRuntimeProfiles | null } | null>(null);
  useEffect(() => {
    if (!backend) return;
    let alive = true;
    fetch(`/api/ui/backends/runtime-profiles/${encodeURIComponent(backend)}`, { cache: 'no-store' })
      .then(async (res) => (res.ok ? asOffered(await res.json()) : null))
      .catch(() => null)
      .then((value) => { if (alive) setOffered({ backend, value }); });
    return () => { alive = false; };
  }, [backend]);
  return offered && offered.backend === backend ? offered.value : null;
}

const FIELD = 'h-8 w-full max-w-xs rounded-md border border-input bg-background px-2 text-[12px] text-foreground';

export function RuntimeProfileSelect({
  offered,
  value,
  onChange,
}: {
  offered: OfferedRuntimeProfiles | null;
  value: string;
  onChange: (name: string) => void;
}): React.ReactElement | null {
  if (!offered) return null;
  const options = runtimeProfileOptions(offered.names, value);
  const missing = options.some((option) => option.missing);
  return (
    <div className="flex flex-col gap-2">
      <select
        data-runtime-profile
        aria-label={offered.label}
        className={FIELD}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value || '(default)'} value={option.value}>
            {option.value === ''
              ? t('editPage.runtimeProfileDefault')
              : option.missing ? t('editPage.runtimeProfileMissingOption', { name: option.value }) : option.value}
          </option>
        ))}
      </select>
      {missing && (
        <p
          role="note"
          data-runtime-profile-missing
          className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-2 text-[12px] text-amber-900 dark:text-amber-200"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t('editPage.runtimeProfileMissing', { name: value })}</span>
        </p>
      )}
    </div>
  );
}
