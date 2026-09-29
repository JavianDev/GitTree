import type {
  PullRequestCommentThread,
  PullRequestConnection,
  PullRequestDetail,
  PullRequestEntry,
  PullRequestStatus,
  PullRequestVote,
} from '@shared/model';
import type { GitService } from '../git/GitService';
import { detectProvider, type DetectedProvider } from './detectProvider';
import type {
  AddCommentInput,
  CompleteOptions,
  CreatePrInput,
  EnsureFetchedResult,
  PullRequestProvider,
} from './PullRequestProvider';

/**
 * Per-repo façade over whichever `PullRequestProvider` `detectProvider`
 * matched — the RPC handlers in `GitTreePanel.ts` delegate to this 1:1, and
 * every public method mirrors a `pullRequests/*` RPC by name.
 *
 * Deliberately holds no `context.secrets`/`workspaceState` of its own (the
 * zero-persistence-at-this-layer requirement): GitLab's PAT lives in the
 * `GitLabProvider` instance itself, shared across repos, not duplicated here.
 */
export class PullRequestService {
  private detected: DetectedProvider | undefined | 'pending' = 'pending';

  constructor(
    private readonly git: GitService,
    private readonly providers: readonly PullRequestProvider[],
  ) {}

  private async resolve(): Promise<DetectedProvider | undefined> {
    if (this.detected !== 'pending') return this.detected;

    const remotes = await this.git.remotes({ priority: 'visible' });
    this.detected = detectProvider(remotes);
    return this.detected;
  }

  private providerFor(id: DetectedProvider['provider']): PullRequestProvider {
    const provider = this.providers.find((candidate) => candidate.id === id);
    if (!provider) throw new Error(`No PullRequestProvider registered for '${id}'.`);
    return provider;
  }

  /** Silent only — never shows a sign-in popup. Safe to call on every panel load. */
  async connection(): Promise<PullRequestConnection> {
    const detected = await this.resolve();
    if (!detected) return { detected: false, signedIn: false };

    const provider = this.providerFor(detected.provider);
    const token = await provider.session(false);

    return {
      detected: true,
      provider: detected.provider,
      owner: detected.ref.owner,
      repo: detected.ref.repo,
      ...(detected.ref.project ? { project: detected.ref.project } : {}),
      signedIn: Boolean(token),
    };
  }

  /** The only method in this service that can show a sign-in popup. */
  async signIn(): Promise<{ signedIn: boolean }> {
    const detected = await this.resolve();
    if (!detected) return { signedIn: false };

    const provider = this.providerFor(detected.provider);
    const token = await provider.session(true);
    return { signedIn: Boolean(token) };
  }

  private async requireToken(): Promise<{ provider: PullRequestProvider; ref: DetectedProvider['ref']; token: string }> {
    const detected = await this.resolve();
    if (!detected) throw new Error('This repository is not hosted on a supported pull request provider.');

    const provider = this.providerFor(detected.provider);
    const token = await provider.session(false);
    if (!token) throw new Error('Not signed in.');

    return { provider, ref: detected.ref, token };
  }

  async list(status: PullRequestStatus): Promise<PullRequestEntry[]> {
    const { provider, ref, token } = await this.requireToken();
    return provider.list(ref, status, token);
  }

  async get(id: number): Promise<PullRequestDetail> {
    const { provider, ref, token } = await this.requireToken();
    const [detail, commits] = await Promise.all([
      provider.get(ref, id, token),
      provider.commits(ref, id, token).catch(() => []),
    ]);
    return { ...detail, commits };
  }

  async create(input: CreatePrInput): Promise<{ id: number }> {
    const { provider, ref, token } = await this.requireToken();
    return provider.create(ref, input, token);
  }

  async vote(id: number, vote: PullRequestVote): Promise<void> {
    const { provider, ref, token } = await this.requireToken();
    await provider.vote(ref, id, vote, token);
  }

  async complete(id: number, options: CompleteOptions): Promise<void> {
    const { provider, ref, token } = await this.requireToken();
    await provider.complete(ref, id, options, token);
  }

  async abandon(id: number): Promise<void> {
    const { provider, ref, token } = await this.requireToken();
    await provider.abandon(ref, id, token);
  }

  async commentThreads(id: number): Promise<PullRequestCommentThread[]> {
    const { provider, ref, token } = await this.requireToken();
    return provider.commentThreads(ref, id, token);
  }

  async addComment(id: number, input: AddCommentInput): Promise<{ threadId: number }> {
    const { provider, ref, token } = await this.requireToken();
    return provider.addComment(ref, id, input, token);
  }

  /**
   * Overall PR diff always uses `mergeBaseOid..sourceOid` (three-dot
   * semantics), matching what each provider's own "Files changed" tab
   * shows — not a raw two-dot `target..source` diff, which would include
   * unrelated commits landed on target since the branch point.
   */
  async ensureFetched(id: number): Promise<EnsureFetchedResult> {
    const { provider, ref, token } = await this.requireToken();
    const detail = await provider.get(ref, id, token);
    return provider.ensureFetched(ref, id, detail, this.git);
  }
}
