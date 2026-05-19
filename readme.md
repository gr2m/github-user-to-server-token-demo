# github-user-to-server-token-demo

A small demo that uses [`octokit`](https://github.com/octokit/octokit.js) to:

1. Open a pull request and an issue using an **installation access token**.
2. Open another pull request and issue, and post a comment on each, using a **user-to-server token** obtained through the **OAuth Device Flow**.

## Demo

https://github.com/user-attachments/assets/49820459-742d-47c7-9b2a-49654c4f1146

example pull requests

1. server-to-server (installation access) token: https://github.com/gr2m/sandbox/pull/318
2. user-to-server: https://github.com/gr2m/sandbox/pull/319

## 1. Register a GitHub App

Create a new GitHub App at <https://github.com/settings/apps/new> (or in your organization settings) with the following configuration:

- **Webhook** — Disabled (uncheck "Active").
- **Repository permissions**
  - **Pull requests**: Read and write
  - **Contents**: Read and write (needed to push the branch the PR is opened from)
  - **Issues**: Read and write
- **Device Flow** — Enable "Enable Device Flow" under *Identifying and authorizing users*.

After creating the app:

1. **Generate a private key** and download the `.pem` file.
2. Note the **App ID**.
3. **Install** the app on the repository you want to run the demo against.

## 2. Convert the private key to PKCS#8

GitHub issues private keys in **PKCS#1** format (`-----BEGIN RSA PRIVATE KEY-----`), but `octokit` (and the underlying Node `crypto` JWT signer) requires **PKCS#8** (`-----BEGIN PRIVATE KEY-----`). Convert it once with OpenSSL:

```sh
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in private-key.pem \
  -out private-key.pkcs8.pem
```

The resulting `private-key.pkcs8.pem` is what you'll use in the next step. You can verify it starts with `-----BEGIN PRIVATE KEY-----` (no `RSA`).

## 3. Install dependencies

```sh
npm install
```

## 4. Configure environment variables

Copy the example file and fill in the values:

```sh
cp .env.example .env
```

Then edit `.env` and set:

- `GITHUB_APP_ID` — your GitHub App's numeric App ID.
- `GITHUB_APP_PRIVATE_KEY` — the full PEM contents of the **PKCS#8** key from the previous step, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. **Replace every line break in the PEM with the literal two characters `\n`** so the whole key fits on a single line, and wrap the value in double quotes. For example:

  ```
  GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIB...\n...AQAB\n-----END PRIVATE KEY-----\n"
  ```

  You can produce this from your `.pkcs8.pem` file with:

  ```sh
  awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' /path/to/private-key.pkcs8.pem
  ```

  The demo converts the `\n` escapes back into real newlines before passing the key to `octokit`.

## 5. Run the demo

```sh
node --env-file=.env demo.js <owner>/<repo>
```

For example:

```sh
node --env-file=.env demo.js octocat/hello-world
```

The script will:

1. Authenticate as the GitHub App, find the installation on the given repository, and open a pull request and an issue using an installation access token.
2. Start the OAuth Device Flow. You will be prompted to open a URL such as <https://github.com/login/device> and enter a one-time user code. Once you authorize the app, the demo continues and — using the user-to-server token — opens a second pull request and posts a comment on it, then opens an issue and posts a comment on it.

## License

[ISC](license.md)
