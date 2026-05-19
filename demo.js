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

async function commentOnPullRequest(octokit, pullRequest, body) {
  const { data: comment } = await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner,
      repo,
      issue_number: pullRequest.number,
      body,
    }
  );
  return comment;
}

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

function logRequestError(prefix, error) {
  if (error instanceof RequestError) {
    console.error(
      `${prefix}: ${error.status} ${error.message}` +
        (error.response?.data?.errors
          ? `\n  ${JSON.stringify(error.response.data.errors)}`
          : "")
    );
  } else {
    console.error(`${prefix}: ${error.message ?? error}`);
  }
}

try {
  const appInfo = await getAppInfo();
  console.log(`Authenticated as GitHub App: ${appInfo.slug} (id: ${appInfo.id})`);

  const installationOctokit = await getInstallationOctokit();

  console.log("\n[1/2] Creating pull request with installation access token...");
  const installationPR = await createPullRequest(
    installationOctokit,
    "installation"
  );
  console.log(`  Created: ${installationPR.html_url}`);

  console.log("\n[2/2] Authorizing user via OAuth Device Flow...");
  const userToken = await getUserToken(appInfo.client_id);
  console.log("  Received user-to-server token.");

  const userOctokit = new Octokit({ auth: userToken });
  const {
    data: { login },
  } = await userOctokit.request("GET /user");
  console.log(`  Authenticated as user: ${login}`);

  console.log("\n      Creating pull request with user-to-server token...");
  const userPR = await createPullRequest(userOctokit, "user-to-server");
  console.log(`  Created: ${userPR.html_url}`);

  console.log("      Commenting on the pull request...");
  const comment = await commentOnPullRequest(
    userOctokit,
    userPR,
    `:wave: Hello from @${login} via a user-to-server token.`
  );
  console.log(`  Created: ${comment.html_url}`);

  console.log("\nDone.");
} catch (error) {
  logRequestError("Demo failed", error);
  process.exit(1);
}
