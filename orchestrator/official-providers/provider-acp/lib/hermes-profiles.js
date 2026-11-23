// @ts-check
/**
 * The Hermes profiles an agent may run on (`AcpAgentSpec.runtimeProfiles` of the Hermes row).
 *
 * A Hermes profile is a named home under `<root>/profiles/<name>`: its own `config.yaml` (model,
 * providers, custom endpoints), `.env`, skills, memory and sessions. Hermes runs on one when
 * `HERMES_HOME` points at it, the same way `hermes --profile <name>` does it; so an agent that
 * names a profile runs `hermes-acp` with that `HERMES_HOME`, and the models the agent announces
 * in `session/new` are that profile's. Timon reads the folder names and nothing else, and never
 * writes into a profile.
 *
 * What counts as a profile follows Hermes' own listing (`hermes_cli/profiles.py`,
 * `_iter_named_profile_dirs`, Hermes 0.23): a folder whose name matches `PROFILE_ID_RE`, is not
 * `default`, holds one of the identity files, and has no tombstone in `profiles/.deleted/`. The root
 * follows `hermes_constants._hermes_root_of`: the `HERMES_HOME` the daemon forwards (`envFrom`) when
 * it is set, the root above it when it already names a profile, the platform default otherwise.
 *
 * @typedef {import('@timon-ai/sdk/provider').RuntimeProfilesStrategy} RuntimeProfilesStrategy
 * @typedef {{ platform?: NodeJS.Platform, homedir?: () => string, localAppData?: string }} HostFacts
 */
import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';

/** Hermes' grammar for a profile id (`hermes_constants.PROFILE_ID_RE`). */
export const HERMES_PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Files that make a folder under `profiles/` a profile (`hermes_constants._PROFILE_IDENTITY_MARKERS`). */
const IDENTITY_MARKERS = Object.freeze(['config.yaml', '.env', 'SOUL.md', 'profile.yaml', 'auth.json', 'state.db']);

/** Hermes' home when nothing names another one: `~/.hermes`, `%LOCALAPPDATA%\hermes` on Windows. */
function platformHome(/** @type {HostFacts} */ host) {
  const home = (host.homedir ?? osHomedir)();
  if ((host.platform ?? process.platform) === 'win32') {
    const local = (host.localAppData ?? process.env.LOCALAPPDATA ?? '').trim();
    return join(local || join(home, 'AppData', 'Local'), 'hermes');
  }
  return join(home, '.hermes');
}

/**
 * The root that holds the Hermes profiles, for a process started with `env`.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {HostFacts} [host]
 */
export function hermesRoot(env, host = {}) {
  const native = platformHome(host);
  const raw = (env.HERMES_HOME ?? '').trim();
  if (!raw) return native;
  const home = (host.homedir ?? osHomedir)();
  const expanded = raw === '~' ? home : raw.startsWith('~/') || raw.startsWith('~\\') ? join(home, raw.slice(2)) : raw;
  const path = resolve(expanded);
  const inside = relative(resolve(native), path);
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) return native;
  return basename(dirname(path)) === 'profiles' ? dirname(dirname(path)) : path;
}

/** @param {string} home */
function isProfileHome(home) {
  return IDENTITY_MARKERS.some((marker) => {
    try { return lstatSync(join(home, marker)).isFile() || lstatSync(join(home, marker)).isSymbolicLink(); } catch { return false; }
  });
}

/** @param {string} root @param {string} name */
function isLiveProfile(root, name) {
  if (name === 'default' || !HERMES_PROFILE_ID.test(name)) return false;
  const home = join(root, 'profiles', name);
  try { if (!statSync(home).isDirectory()) return false; } catch { return false; }
  return isProfileHome(home) && !existsSync(join(root, 'profiles', '.deleted', name));
}

/**
 * The strategy the Hermes row declares.
 * @param {HostFacts} [host]
 * @returns {RuntimeProfilesStrategy}
 */
export function hermesProfiles(host = {}) {
  return {
    label: 'Hermes profile',
    list: async (profile) => {
      const root = hermesRoot(profile.env, host);
      let names;
      try { names = readdirSync(join(root, 'profiles')); } catch { return []; }
      return names.filter((name) => isLiveProfile(root, name)).sort();
    },
    env: (name, profile) => {
      if (name === 'default') {
        throw new Error('"default" is Hermes\' own home, not a named profile: leave the field empty to run on it');
      }
      if (!HERMES_PROFILE_ID.test(name)) throw new Error(`"${name}" is not a Hermes profile name`);
      const root = hermesRoot(profile.env, host);
      if (!isLiveProfile(root, name)) {
        throw new Error(`Hermes profile "${name}" does not exist under ${root}: create it with \`hermes profile create ${name}\`, `
          + 'or pick one `hermes profile list` shows');
      }
      return { HERMES_HOME: join(root, 'profiles', name) };
    },
  };
}
