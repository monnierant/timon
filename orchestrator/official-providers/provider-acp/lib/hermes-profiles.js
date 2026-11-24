// @ts-check
/**
 * The Hermes profiles an agent may run on (`AcpAgentSpec.runtimeProfiles` of the Hermes row).
 *
 * A Hermes profile is a named home under `<root>/profiles/<name>`: its own `config.yaml` (model,
 * providers, custom endpoints), `.env`, skills, memory and sessions. Hermes runs on one when
 * `HERMES_HOME` points at it, the same way `hermes --profile <name>` does it; so an agent that
 * names a profile runs `hermes-acp` with that `HERMES_HOME`, and the models the agent announces
 * in `session/new` are that profile's. Timon reads the folder names, and writes one thing only,
 * when the operator turned `TIMON_RUNTIME_PROFILE_SKILL` on: its own `timon` skill in the
 * `skills/` folder of the home an agent runs on (`skills.dir`), which Hermes loads by name.
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

/**
 * The home a Hermes process started with `env` runs on (`hermes_constants.get_hermes_home`): its
 * `HERMES_HOME` as given, `~` expanded, the platform default when it is empty. Null for a value
 * Hermes would expand further (`$VAR`) or resolve against its own working folder: Timon does not guess.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {HostFacts} host
 */
function launchedHome(env, host) {
  const raw = (env.HERMES_HOME ?? '').trim();
  if (!raw) {
    const suffix = (env.HERMES_DATA_DIR_SUFFIX ?? '').trim();
    const native = platformHome(host);
    return suffix ? `${native}${suffix}` : native;
  }
  if (raw.includes('$') || raw.includes('%')) return null;
  const home = (host.homedir ?? osHomedir)();
  const expanded = raw === '~' ? home : raw.startsWith('~/') || raw.startsWith('~\\') ? join(home, raw.slice(2)) : raw;
  return isAbsolute(expanded) ? expanded : null;
}

/**
 * How a Timon tool is named under Hermes 0.23 (`gateway/session_local_mcp.py`, `_server_names`;
 * `tools/mcp_tool_schema.py`, `mcp_prefixed_tool_name`) and how a deferred one is loaded
 * (`tool_search`, `tool_describe`, `tool_call`). For the skill: never a full name, it changes per session.
 */
const HERMES_TOOL_NAMES = [
  'In Hermes, a Timon tool is named `mcp__editor_timon_<8 hex>__<tool>`: the',
  '8 hex characters change with every session, and a long name is shortened',
  'with a hash at its end. Hermes may also hold MCP tools back until you ask',
  'for them. So, to call `kanban_list`: if a tool whose name ends in',
  '`__kanban_list` is in your tool list, call it; otherwise search with',
  '`tool_search` (`queries: ["kanban list"]`), load its schema with `tool_describe`',
  'using the exact name the search returned, then call it with `tool_call`.',
].join('\n');

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
    skills: {
      dir: (env) => {
        const home = launchedHome(env, host);
        return home ? join(home, 'skills') : null;
      },
      toolNames: HERMES_TOOL_NAMES,
    },
  };
}
