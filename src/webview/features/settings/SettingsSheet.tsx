import { useCallback, useEffect, useState } from 'react';
import type { GitRemote, RepoSettings } from '@shared/model';
import { THEMES, THEME_TITLES, type ThemeModel } from '../../app/useTheme';
import { RpcRequestError, rpc } from '../../rpc/client';

/**
 * The display preferences the sheet owns on the shell's behalf.
 *
 * A subset of the shell's history options rather than a copy of them: these two
 * are set once and forgotten, which is why they left the context bar, but the
 * commit tree still reads them from the same state the scope selector does.
 */
export interface AppearanceOptions {
  order: 'date' | 'topo';
  showRemotes: boolean;
}

export interface SettingsSheetProps {
  repoId: string;
  model: ThemeModel;
  appearance: AppearanceOptions;
  onAppearance: (next: AppearanceOptions) => void;
  onShowShortcuts: () => void;
  onClose: () => void;
}

interface UserDraft {
  name: string;
  email: string;
  useGlobal: boolean;
}

interface RemoteDraft {
  fetchUrl: string;
  pushUrl: string;
}

const EMPTY_REMOTE_DRAFT: RemoteDraft = { fetchUrl: '', pushUrl: '' };

/** The sections in the navigation rail, in order. */
type SectionId = 'remotes' | 'identity' | 'appearance' | 'repository';

const SECTIONS: Array<{ id: SectionId; label: string; hint: string }> = [
  { id: 'remotes', label: 'Remotes', hint: 'Where this repository pushes and fetches' },
  { id: 'identity', label: 'Identity', hint: 'The name and email on your commits' },
  { id: 'appearance', label: 'Appearance', hint: 'Theme and how history is displayed' },
  { id: 'repository', label: 'Repository', hint: 'Paths and versions' },
];

/**
 * The last settings read for each repository.
 *
 * The sheet unmounts when it closes, so without this every reopen showed a
 * spinner while five git invocations re-read values that change perhaps monthly.
 * The cached copy paints immediately and is replaced the moment the fresh read
 * lands, so the panel is never *wrong* — only occasionally a second stale.
 */
const CACHE = new Map<string, RepoSettings>();

/* -------------------------------------------------------------------------- */
/* Pure edits                                                                 */
/* -------------------------------------------------------------------------- */

function userDraftFrom(settings: RepoSettings): UserDraft {
  return {
    name: settings.userName ?? '',
    email: settings.userEmail ?? '',
    useGlobal: settings.usesGlobalUser,
  };
}

/**
 * The identity write this draft asks for, or undefined when nothing moved.
 *
 * An omitted field means "leave that key alone", never "clear it", so only the
 * values that actually changed are sent: echoing the unchanged name back would
 * write a local override into a repository that had none and quietly detach it
 * from the global identity.
 */
function userWrite(
  settings: RepoSettings,
  draft: UserDraft,
): { name?: string; email?: string; useGlobal: boolean } | undefined {
  if (draft.useGlobal) return settings.usesGlobalUser ? undefined : { useGlobal: true };

  const name = draft.name.trim();
  const email = draft.email.trim();
  const changedName = name !== (settings.userName ?? '');
  const changedEmail = email !== (settings.userEmail ?? '');
  if (!changedName && !changedEmail) return undefined;

  return {
    useGlobal: false,
    ...(changedName ? { name } : {}),
    ...(changedEmail ? { email } : {}),
  };
}

/**
 * The URL write for one remote, or undefined when neither direction changed.
 *
 * Each direction is sent only when it differs, because the host writes every
 * supplied URL with its own `set-url` invocation — sending both every time
 * would put two entries in the command log for a one-field edit.
 */
function remoteWrite(
  remote: GitRemote,
  draft: RemoteDraft,
): { fetchUrl?: string; pushUrl?: string } | undefined {
  const fetchUrl = draft.fetchUrl.trim();
  const pushUrl = draft.pushUrl.trim();
  const changedFetch = fetchUrl.length > 0 && fetchUrl !== remote.fetchUrl;
  const changedPush = pushUrl.length > 0 && pushUrl !== remote.pushUrl;
  if (!changedFetch && !changedPush) return undefined;

  return {
    ...(changedFetch ? { fetchUrl } : {}),
    ...(changedPush ? { pushUrl } : {}),
  };
}

function describe(error: unknown): string {
  return error instanceof RpcRequestError ? error.displayText : String(error);
}

/* -------------------------------------------------------------------------- */

/**
 * Repository settings.
 *
 * What the gear should always have opened. Everything here that touches git
 * goes through the host's write path, so a config edit lands in the command log
 * beside the commands the toolbar runs — a settings screen that mutated config
 * invisibly would be the one place the tool stopped teaching.
 *
 * Behaviour is read-only by construction: those preferences are VS Code
 * settings, and a webview cannot write them. Showing them here with their home
 * named is better than pretending they do not exist.
 */
export function SettingsSheet({
  repoId,
  model,
  appearance,
  onAppearance,
  onShowShortcuts,
  onClose,
}: Readonly<SettingsSheetProps>): React.JSX.Element {
  // Seeded from the cache so a reopen paints at once rather than spinning.
  const [settings, setSettings] = useState<RepoSettings | undefined>(() => CACHE.get(repoId));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [section, setSection] = useState<SectionId>('remotes');

  const [user, setUser] = useState<UserDraft>({ name: '', email: '', useGlobal: true });
  const [editing, setEditing] = useState<string | undefined>();
  const [remoteDraft, setRemoteDraft] = useState<RemoteDraft>(EMPTY_REMOTE_DRAFT);
  const [adding, setAdding] = useState<{ name: string; url: string } | undefined>();

  useEffect(() => {
    let cancelled = false;

    rpc
      .request('settings/get', { repoId })
      .then((next) => {
        CACHE.set(repoId, next);
        if (cancelled) return;
        setSettings(next);
        // Drafts follow the config: after a write the fields must show what git
        // now holds, not what was typed to get there.
        setUser(userDraftFrom(next));
        setEditing(undefined);
        setAdding(undefined);
      })
      .catch((reason) => {
        if (!cancelled) setError(describe(reason));
      });

    return () => {
      cancelled = true;
    };
  }, [repoId, revision]);

  /**
   * Runs one write and re-reads.
   *
   * Only `remotes/remove` publishes an event, so the sheet cannot rely on the
   * shell's refresh to tell it what changed; it re-reads for itself. Failures
   * arrive as an RpcError carrying git's stderr, which is the whole diagnostic
   * for a rejected `remote add`, so it is shown verbatim.
   */
  const write = useCallback((work: Promise<void>) => {
    setBusy(true);
    setError(undefined);

    work
      .then(() => setRevision((current) => current + 1))
      .catch((reason: unknown) => setError(describe(reason)))
      .finally(() => setBusy(false));
  }, []);

  const beginEdit = (remote: GitRemote) => {
    setEditing(remote.name);
    setRemoteDraft({ fetchUrl: remote.fetchUrl, pushUrl: remote.pushUrl });
  };

  const saveRemote = (remote: GitRemote) => {
    const change = remoteWrite(remote, remoteDraft);
    if (!change) return setEditing(undefined);
    write(rpc.request('remotes/setUrl', { repoId, name: remote.name, ...change }));
  };

  const saveUser = () => {
    if (!settings) return;
    const change = userWrite(settings, user);
    if (change) write(rpc.request('settings/setUser', { repoId, ...change }));
  };

  const openIgnoreFile = () => {
    if (!settings) return;
    // Repo-relative on purpose: `editor/open` resolves against the repository
    // root, so an absolute path would resolve to <root>/<root>/.gitignore.
    void rpc
      .request('editor/open', { repoId, path: settings.ignoreFile })
      .catch((reason: unknown) => setError(describe(reason)));
  };

  const pendingUser = settings ? userWrite(settings, user) : undefined;

  return (
    <div
      className="gt-sheet-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        className="gt-sheet gt-sheet-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gt-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gt-settings-header">
          <h2 className="gt-sheet-title" id="gt-settings-title">
            Settings
          </h2>
          <p className="gt-settings-subtitle">
            {settings ? repoName(settings.root) : 'Reading repository…'}
          </p>
        </header>

        {error && (
          <div className="gt-settings-error" role="alert">
            {/* Verbatim: git's own refusal says more than any rewording. */}
            <pre>{error}</pre>
          </div>
        )}

        {/*
          The panel renders immediately rather than waiting on git.
          Everything used to sit behind the loaded settings, so opening it showed
          a single line of text until five invocations finished — which read as
          the panel being slow when most of it needs no git at all. Appearance is
          fully usable at once; the git-backed sections show their shape and fill
          in.
        */}
        <div className="gt-settings-layout">
          <nav className="gt-settings-nav" aria-label="Settings sections">
            {SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="gt-settings-nav-item"
                aria-current={section === entry.id}
                title={entry.hint}
                onClick={() => setSection(entry.id)}
              >
                <span className="gt-settings-nav-label">{entry.label}</span>
                <span className="gt-settings-nav-hint">{entry.hint}</span>
              </button>
            ))}
          </nav>

          <div className="gt-settings-body">
            {section === 'remotes' && !settings && <SectionSkeleton rows={3} />}
            {section === 'remotes' && settings && (
            <section className="gt-settings-section">
              <h3 className="gt-settings-heading">Remotes</h3>
              <p className="gt-settings-note">
                A remote is a named copy of this repository somewhere else. Fetch and push both
                go to whichever one you name.
              </p>

              {settings.remotes.length === 0 && (
                <p className="gt-settings-note">
                  This repository has no remotes. Add one to fetch and push.
                </p>
              )}

              <ul className="gt-remote-list">
                {settings.remotes.map((remote) => (
                  <li className="gt-remote" key={remote.name}>
                    <span className="gt-remote-name">{remote.name}</span>

                    {editing === remote.name ? (
                      <div className="gt-remote-fields">
                        <LabelledInput
                          label="Fetch URL"
                          value={remoteDraft.fetchUrl}
                          onChange={(fetchUrl) =>
                            setRemoteDraft((current) => ({ ...current, fetchUrl }))
                          }
                        />
                        <LabelledInput
                          label="Push URL"
                          value={remoteDraft.pushUrl}
                          onChange={(pushUrl) =>
                            setRemoteDraft((current) => ({ ...current, pushUrl }))
                          }
                        />
                      </div>
                    ) : (
                      <div className="gt-remote-urls">
                        <span className="gt-mono">{remote.fetchUrl}</span>
                        {/* Only worth a second line when it differs; git falls
                            back to the fetch URL when no pushurl is set. */}
                        {remote.pushUrl !== remote.fetchUrl && (
                          <span className="gt-mono">push: {remote.pushUrl}</span>
                        )}
                      </div>
                    )}

                    <div className="gt-remote-actions">
                      {editing === remote.name ? (
                        <>
                          <button
                            type="button"
                            className="gt-button"
                            data-size="small"
                            onClick={() => setEditing(undefined)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="gt-button"
                            data-size="small"
                            data-variant="primary"
                            disabled={busy}
                            onClick={() => saveRemote(remote)}
                          >
                            Save
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="gt-button"
                            data-size="small"
                            onClick={() => beginEdit(remote)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="gt-button"
                            data-size="small"
                            data-variant="destructive"
                            disabled={busy}
                            title="Also deletes this remote's remote-tracking branches"
                            onClick={() =>
                              write(rpc.request('remotes/remove', { repoId, name: remote.name }))
                            }
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {adding ? (
                <div className="gt-remote-form">
                  <LabelledInput
                    label="Name"
                    value={adding.name}
                    onChange={(name) => setAdding({ ...adding, name })}
                  />
                  <LabelledInput
                    label="URL"
                    value={adding.url}
                    onChange={(url) => setAdding({ ...adding, url })}
                  />
                  <div className="gt-remote-actions">
                    <button
                      type="button"
                      className="gt-button"
                      data-size="small"
                      onClick={() => setAdding(undefined)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="gt-button"
                      data-size="small"
                      data-variant="primary"
                      disabled={busy || !adding.name.trim() || !adding.url.trim()}
                      onClick={() =>
                        write(
                          rpc.request('remotes/add', {
                            repoId,
                            name: adding.name.trim(),
                            url: adding.url.trim(),
                          }),
                        )
                      }
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="gt-button"
                  data-size="small"
                  onClick={() => setAdding({ name: '', url: '' })}
                >
                  Add remote…
                </button>
              )}
            </section>
            )}

            {section === 'identity' && !settings && <SectionSkeleton rows={2} />}
            {section === 'identity' && settings && (
            <section className="gt-settings-section">
              <h3 className="gt-settings-heading">Identity</h3>
              <p className="gt-settings-note">
                The name and email recorded as the author of every commit you make here.
              </p>

              <label className="gt-checkbox">
                <input
                  type="checkbox"
                  checked={user.useGlobal}
                  onChange={(event) =>
                    setUser((current) => ({ ...current, useGlobal: event.target.checked }))
                  }
                />
                Use global user settings
              </label>

              {user.useGlobal ? (
                <div className="gt-settings-rows">
                  <ReadOnlyRow label="Name" value={settings.globalUserName ?? 'Not set'} />
                  <ReadOnlyRow label="Email" value={settings.globalUserEmail ?? 'Not set'} />
                  <p className="gt-settings-note">
                    This repository uses your global identity. If you change that identity
                    later, this repository follows it — nothing here is pinned to today's
                    values.
                  </p>
                </div>
              ) : (
                <div className="gt-settings-rows">
                  <LabelledInput
                    label="Name"
                    value={user.name}
                    onChange={(name) => setUser((current) => ({ ...current, name }))}
                  />
                  <LabelledInput
                    label="Email"
                    value={user.email}
                    onChange={(email) => setUser((current) => ({ ...current, email }))}
                  />
                </div>
              )}

              <div className="gt-remote-actions">
                <button
                  type="button"
                  className="gt-button"
                  data-size="small"
                  data-variant="primary"
                  disabled={busy || !pendingUser}
                  onClick={saveUser}
                >
                  Apply identity
                </button>
              </div>
            </section>
            )}

            {section === 'appearance' && (
            <section className="gt-settings-section">
              <h3 className="gt-settings-heading">Appearance</h3>
              <p className="gt-settings-note">
                Applies to every repository, and takes effect straight away.
              </p>

              <div className="gt-settings-rows">
                <div className="gt-settings-row">
                  <span className="gt-settings-label">Theme</span>
                  <select
                    className="gt-settings-select"
                    aria-label="Theme"
                    value={model.theme}
                    onChange={(event) => {
                      const chosen = THEMES.find((theme) => theme === event.target.value);
                      if (chosen) model.set(chosen);
                    }}
                  >
                    {THEMES.map((theme) => (
                      <option key={theme} value={theme}>
                        {THEME_TITLES[theme]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="gt-settings-row">
                  <span className="gt-settings-label">Commit ordering</span>
                  <select
                    className="gt-settings-select"
                    aria-label="Commit ordering"
                    value={appearance.order}
                    onChange={(event) =>
                      onAppearance({
                        ...appearance,
                        order: event.target.value === 'topo' ? 'topo' : 'date',
                      })
                    }
                  >
                    <option value="date">Date Order</option>
                    <option value="topo">Topological</option>
                  </select>
                </div>

                <div className="gt-settings-row">
                  <span className="gt-settings-label">Remote branches</span>
                  <label className="gt-checkbox">
                    <input
                      type="checkbox"
                      checked={appearance.showRemotes}
                      onChange={(event) =>
                        onAppearance({ ...appearance, showRemotes: event.target.checked })
                      }
                    />
                    Show in the commit tree
                  </label>
                </div>
              </div>
            </section>
            )}

            {section === 'repository' && !settings && <SectionSkeleton rows={4} />}
            {section === 'repository' && settings && (
            <section className="gt-settings-section">
              <h3 className="gt-settings-heading">Repository</h3>

              <div className="gt-settings-rows">
                <ReadOnlyRow label="Path" value={settings.root} mono />
                <ReadOnlyRow label="Kind" value={settings.kind} />
                <ReadOnlyRow
                  label="Git version"
                  value={settings.gitVersion || 'git was not located'}
                />
                <div className="gt-settings-row">
                  <span className="gt-settings-label">Ignore file</span>
                  <span className="gt-settings-value gt-mono">
                    {settings.root}/{settings.ignoreFile}
                  </span>
                  <button
                    type="button"
                    className="gt-button"
                    data-size="small"
                    onClick={openIgnoreFile}
                  >
                    Open
                  </button>
                </div>
              </div>

              <button type="button" className="gt-button" data-size="small" onClick={onShowShortcuts}>
                Keyboard shortcuts…
              </button>
            </section>
            )}
          </div>
        </div>

        <div className="gt-sheet-actions">
          <button type="button" className="gt-button" data-variant="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Placeholder rows while git is still answering.
 *
 * Shaped like the content it replaces rather than a spinner, so the panel does
 * not resize under the pointer the moment the data lands.
 */
function SectionSkeleton({ rows }: Readonly<{ rows: number }>): React.JSX.Element {
  return (
    <div className="gt-settings-section" aria-hidden="true">
      <div className="gt-settings-skeleton-heading" />
      <div className="gt-settings-rows">
        {Array.from({ length: rows }, (_, index) => (
          <div className="gt-settings-skeleton-row" key={index} />
        ))}
      </div>
    </div>
  );
}

/** The folder name, which identifies the repository more usefully than its path. */
function repoName(root: string): string {
  const segments = root.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? root;
}

function LabelledInput({
  label,
  value,
  onChange,
}: Readonly<{ label: string; value: string; onChange: (value: string) => void }>): React.JSX.Element {
  return (
    <label className="gt-settings-row">
      <span className="gt-settings-label">{label}</span>
      <input
        className="gt-settings-input"
        type="text"
        spellCheck={false}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ReadOnlyRow({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>): React.JSX.Element {
  return (
    <div className="gt-settings-row">
      <span className="gt-settings-label">{label}</span>
      <span className={mono ? 'gt-settings-value gt-mono' : 'gt-settings-value'}>{value}</span>
    </div>
  );
}
