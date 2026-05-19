// @ts-check

import { App, Octokit, RequestError } from "octokit";
import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";

const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } = process.env;

if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY) {
  console.error(
    "Error: GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY environment variables are required."
  );
  process.exit(1);
}

const repoArg = process.argv[2];
if (!repoArg || !repoArg.includes("/")) {
  console.error("Usage: node demo.js <owner>/<repo>");
  process.exit(1);
}

const [owner, repo] = repoArg.split("/");

const app = new App({
  appId: GITHUB_APP_ID,
  privateKey: GITHUB_APP_PRIVATE_KEY,
});

async function getAppInfo() {
  const { data } = await app.octokit.request("GET /app");
  return data;
}

async function getInstallationOctokit() {
  const { data: installation } = await app.octokit.request(
    "GET /repos/{owner}/{repo}/installation",
    { owner, repo }
  );
  return app.getInstallationOctokit(installation.id);
}

/**
 * Create a branch off the default branch, add a file, and open a pull request.
 *
 * @param {InstanceType<typeof Octokit>} octokit
 * @param {string} label - free-form label used in branch/file/PR titles to distinguish runs.
 */
async function createPullRequest(octokit, label) {
  const { data: repository } = await octokit.request(
    "GET /repos/{owner}/{repo}",
    { owner, repo }
  );
  const baseBranch = repository.default_branch;

  const { data: baseRef } = await octokit.request(
    "GET /repos/{owner}/{repo}/git/ref/{ref}",
    { owner, repo, ref: `heads/${baseBranch}` }
  );

  const timestamp = Date.now();
  const branchName = `octokit-demo/${label}-${timestamp}`;

  await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseRef.object.sha,
  });

  const filePath = `octokit-demo/${label}-${timestamp}.md`;
  const fileContent = Buffer.from(
    `# octokit demo (${label})\n\nCreated at ${new Date().toISOString()}\n`
  ).toString("base64");

  await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
    owner,
    repo,
    path: filePath,
    message: `Add ${filePath}`,
    content: fileContent,
    branch: branchName,
  });

  const { data: pullRequest } = await octokit.request(
    "POST /repos/{owner}/{repo}/pulls",
    {
      owner,
      repo,
      title: `octokit demo PR (${label})`,
      head: branchName,
      base: baseBranch,
      body: `This pull request was opened by the octokit demo using a **${label}** token.`,
    }
  );

  return pullRequest;
}

/**
 * @param {InstanceType<typeof Octokit>} octokit
 * @param {string} label
 */
async function createIssue(octokit, label) {
  const { data: issue } = await octokit.request(
    "POST /repos/{owner}/{repo}/issues",
    {
      owner,
      repo,
      title: `octokit demo issue (${label})`,
      body: `This issue was opened by the octokit demo using a **${label}** token.`,
    }
  );
  return issue;
}

/**
 * @param {InstanceType<typeof Octokit>} octokit
 * @param {number} issueOrPullRequestNumber
 * @param {string} body
 */
async function commentOnIssue(octokit, issueOrPullRequestNumber, body) {
  const { data: comment } = await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner,
      repo,
      issue_number: issueOrPullRequestNumber,
      body,
    }
  );
  return comment;
}

/**
 * Run the OAuth Device Flow against the GitHub App's client id and return the
 * resulting user-to-server token.
 *
 * @param {string} clientId
 */
async function getUserToken(clientId) {
  const auth = createOAuthDeviceAuth({
    clientType: "github-app",
    clientId,
    onVerification(verification) {
      console.log("");
      console.log("Open this URL in your browser:");
      console.log(`  ${verification.verification_uri}`);
      console.log("");
      console.log("And enter the following code:");
      console.log(`  ${verification.user_code}`);
      console.log("");
      console.log("Waiting for authorization...");
    },
  });

  const { token } = await auth({ type: "oauth" });
  return token;
}

/**
 * @param {string} prefix
 * @param {unknown} error
 */
function logRequestError(prefix, error) {
  if (error instanceof RequestError) {
    const data = /** @type {{ errors?: unknown } | undefined} */ (
      error.response?.data
    );
    console.error(
      `${prefix}: ${error.status} ${error.message}` +
        (data?.errors ? `\n  ${JSON.stringify(data.errors)}` : "")
    );
  } else if (error instanceof Error) {
    console.error(`${prefix}: ${error.message}`);
  } else {
    console.error(`${prefix}: ${String(error)}`);
  }
}

try {
  const appInfo = await getAppInfo();
  if (!appInfo) {
    throw new Error("Failed to fetch GitHub App info (GET /app returned null).");
  }
  console.log(`Authenticated as GitHub App: ${appInfo.slug} (id: ${appInfo.id})`);

  const installationOctokit = await getInstallationOctokit();

  console.log("\n[1/2] Using installation access token...");
  const installationPR = await createPullRequest(
    installationOctokit,
    "installation"
  );
  console.log(`  Pull request: ${installationPR.html_url}`);
  const installationIssue = await createIssue(installationOctokit, "installation");
  console.log(`  Issue:        ${installationIssue.html_url}`);

  console.log("\n[2/2] Authorizing user via OAuth Device Flow...");
  if (!appInfo.client_id) {
    throw new Error("GitHub App is missing a client_id — cannot start Device Flow.");
  }
  const userToken = await getUserToken(appInfo.client_id);
  console.log("  Received user-to-server token.");

  const userOctokit = new Octokit({ auth: userToken });
  const {
    data: { login },
  } = await userOctokit.request("GET /user");
  console.log(`  Authenticated as user: ${login}`);

  console.log("\n      Using user-to-server token...");
  const userPR = await createPullRequest(userOctokit, "user-to-server");
  console.log(`  Pull request: ${userPR.html_url}`);
  const prComment = await commentOnIssue(
    userOctokit,
    userPR.number,
    `:wave: Hello from @${login} via a user-to-server token.`
  );
  console.log(`  PR comment:   ${prComment.html_url}`);

  const userIssue = await createIssue(userOctokit, "user-to-server");
  console.log(`  Issue:        ${userIssue.html_url}`);
  const issueComment = await commentOnIssue(
    userOctokit,
    userIssue.number,
    `:wave: Hello from @${login} via a user-to-server token.`
  );
  console.log(`  Issue comment: ${issueComment.html_url}`);

  console.log("\nDone.");
} catch (error) {
  logRequestError("Demo failed", error);
  process.exit(1);
}
