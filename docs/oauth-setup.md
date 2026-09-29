# Browser sign-in for Bitbucket and GitLab — one-time setup

Git Tree signs in to **GitHub** and **Azure DevOps** through VS Code's own accounts, so those need
nothing. **Bitbucket** and **GitLab** have no VS Code account, so Git Tree signs in to them with
OAuth: the user clicks *Sign in with your browser*, approves Git Tree on bitbucket.org or gitlab.com,
and is returned to VS Code — no token to create or paste. Logins are kept in VS Code's secret
storage and refreshed automatically.

For that, Git Tree needs to be registered once with each service. Until it is, sign-in falls back
to an API token (Bitbucket) or personal access token (GitLab), exactly as before.

## 1. Register the Bitbucket consumer

1. On **bitbucket.org**, open the workspace you own (your personal workspace is fine) →
   ⚙ **Settings** → **Workspace settings** → **Apps and features** → **OAuth consumers** →
   **Add consumer**.
2. Fill in:
   - **Name:** `Git Tree`
   - **Callback URL:** `http://127.0.0.1:47231/oauth/bitbucket` (exactly this)
   - **Permissions:** Account → *Read*; Repositories → *Read*; Pull requests → *Read* and *Write*
3. **Save**, then expand the new consumer and copy its **Key** and **Secret**.

A consumer registered in your own workspace can be used by anyone to reach the repositories *they*
have access to, in any workspace — unless that workspace's admins block third-party apps, in which
case its members use the API-token option instead.

## 2. Register the GitLab application

1. On **gitlab.com** → your avatar → **Edit profile** → **Applications** → **Add new application**.
2. Fill in:
   - **Name:** `Git Tree`
   - **Redirect URI** (both lines):
     ```
     vscode://javian-picardo-group-inc.git-tree/oauth/gitlab
     vscode-insiders://javian-picardo-group-inc.git-tree/oauth/gitlab
     ```
   - **Confidential:** *unchecked* (Git Tree uses PKCE, so no secret is involved)
   - **Scopes:** `api`
3. **Save application** and copy the **Application ID**.

## 3. Build them into Git Tree

Create `oauth-clients.json` in the repository root (it is git-ignored and never packaged as a file):

```json
{
  "bitbucket": { "key": "<Bitbucket consumer key>", "secret": "<Bitbucket consumer secret>" },
  "gitlab": { "applicationId": "<GitLab application ID>" }
}
```

`npm run build` (and therefore `vsce publish`) prints whether each one was picked up:

```
  browser sign-in: Bitbucket configured, GitLab configured
```

The values can also come from the environment variables `GITTREE_BITBUCKET_OAUTH_KEY`,
`GITTREE_BITBUCKET_OAUTH_SECRET`, and `GITTREE_GITLAB_OAUTH_APP_ID`.

> The Bitbucket secret ends up inside the published extension. That is unavoidable for a desktop
> app — Bitbucket has no secret-less public clients — and is how Git Credential Manager and other
> tools work too. It identifies the *app*, not any user: every user still approves access
> themselves, and can revoke it at any time from their Bitbucket account settings.

## Trying it before a release

Without rebuilding, anyone can point Git Tree at their own registration in VS Code Settings:
`gitTree.bitbucket.oauthConsumerKey` + `gitTree.bitbucket.oauthConsumerSecret`, and
`gitTree.gitlab.oauthApplicationId`. Settings win over the built-in registration.
