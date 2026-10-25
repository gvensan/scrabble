Below is the recommended setup for gvensan/scrabble. Do not paste the Cloudflare token into chat, source files, .env, or shell arguments.

## 1. Create or open your Cloudflare account

1. Sign in at dash.cloudflare.com.
2. Select the account that should own Squabble.
3. Open Workers & Pages.
4. If prompted, activate the Workers Free plan.
5. Ensure a workers.dev subdomain is configured. Cloudflare assigns Workers URLs in the form:

https://squabble-worker.YOUR-SUBDOMAIN.workers.dev

Cloudflare documents the workers.dev setup and naming behavior here.

## 2. Copy the Cloudflare Account ID

In the Cloudflare dashboard:

1. Press ⌘K on macOS or Ctrl+K elsewhere.
2. Search for Copy account ID.
3. Copy the value somewhere temporarily and securely.

Alternatively, open Workers & Pages and find Account Details → Account ID. Cloudflare instructions.

The account ID is not as sensitive as an API token, but this project stores it as a GitHub secret by policy.

## 3. Create a bootstrap API token

Because squabble-worker does not exist yet, the first deployment needs permission to create it.

1. In Cloudflare, open your profile menu.
2. Select My Profile → API Tokens. You can also search the dashboard for API Tokens.
3. Select Create Token.
4. Choose Create Custom Token.
5. Name it something like:

squabble-github-bootstrap

6. Configure the permission using the current granular interface:

Product: Workers
Role: Admin
Scope: your selected Cloudflare account

If your account still shows the legacy permission interface, use:

Account → Workers Scripts → Edit
Account resources → Include → your Cloudflare account

7. Do not add zone permissions. Squabble initially uses workers.dev, not a custom domain.
8. Do not add an IP-address restriction because GitHub-hosted runners use changing addresses.
9. Create the token.
10. Copy the token immediately; Cloudflare displays it only once.

Creating a new Worker currently requires product-level Workers Admin access. Durable Objects do not require a separate permission because their access follows the implementing Worker. Cloudflare authorization reference.

## 4. Add the two secrets to GitHub

Open:

github.com/gvensan/scrabble/settings/secrets/actions

Select New repository secret and add:

Name: CLOUDFLARE_API_TOKEN
Value: the API token from step 3

Then add:

Name: CLOUDFLARE_ACCOUNT_ID
Value: the Account ID from step 2

Then add the admin dashboard token. Generate it straight into GitHub so it never appears on screen or in shell history:

openssl rand -base64 32 | tr -d '/+=\n' | gh secret set ADMIN_TOKEN --repo gvensan/scrabble

To open the deployed dashboard you will need the value once per browser tab. Keep a copy in your password manager: generate it there instead, then run gh secret set ADMIN_TOKEN --repo gvensan/scrabble and paste it at the hidden prompt.

RATE_LIMIT_SALT is already configured. GitHub encrypts Actions secrets and only exposes them to workflows that explicitly reference them. GitHub secret instructions.

You can verify the names without exposing their values:

gh secret list --repo gvensan/scrabble

You should see:

ADMIN_TOKEN
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
RATE_LIMIT_SALT

## 5. Run the first Worker deployment

Open:

github.com/gvensan/scrabble/actions/workflows/worker.yml

Then:

1. Select Run workflow.
2. Choose branch main.
3. Select Run workflow again.
4. Open the resulting workflow run.
5. Wait for Deploy Cloudflare Worker to finish.

The workflow will:

- Run the complete test/build gate.
- Create squabble-worker.
- Create its two SQLite-backed Durable Object namespaces.
- Install RATE_LIMIT_SALT and ADMIN_TOKEN as encrypted Worker secrets.
- Configure the GitHub Pages origin.
- Deploy to workers.dev.

Cloudflare’s official Wrangler GitHub Action supports passing both CI credentials and Worker secrets this way. Wrangler Action documentation.

## 6. Record the Worker URL

The workflow output or Cloudflare dashboard should show something similar to:

https://squabble-worker.example-subdomain.workers.dev

Open its health endpoint:

https://squabble-worker.example-subdomain.workers.dev/health

Expected response:

{"ok":true,"protocolVersion":1}

If this fails, do not continue to Pages yet.

## 7. Add the public Worker URLs to GitHub

Open:

github.com/gvensan/scrabble/settings/variables/actions

Add these repository variables, substituting your real Worker hostname and omitting any trailing slash:

VITE_API_BASE_URL
https://squabble-worker.YOUR-SUBDOMAIN.workers.dev

VITE_WS_BASE_URL
wss://squabble-worker.YOUR-SUBDOMAIN.workers.dev

Important:

- Use https:// for VITE_API_BASE_URL.
- Use wss:// for VITE_WS_BASE_URL.
- Do not append /api or /ws.
- These are public configuration values, not secrets.

ALLOWED_ORIGINS=https://gvensan.github.io is already configured.

Optional: add ROOM_CREATE_LIMIT (rooms one network may create per hour). Without it the Worker allows 10.

## 8. Enable automatic Worker deployment

On the same GitHub Variables page, add:

WORKER_DEPLOY_ENABLED
true

Future Worker-related pushes to main can now deploy automatically.

## 9. Enable GitHub Pages

In GitHub:

1. Open Repository Settings → Pages.
2. Under Build and deployment, set Source to GitHub Actions. If it says Deploy from a branch, change it: that mode publishes the raw source folder, which shows a blank page.
3. Save if prompted.

Then return to repository variables and add:

PAGES_DEPLOY_ENABLED
true

## 10. Run the Pages deployment

Open:

github.com/gvensan/scrabble/actions/workflows/pages.yml

Then:

1. Select Run workflow.
2. Choose main.
3. Select Run workflow.
4. Wait for the workflow to finish.

The resulting application should be available at:

https://gvensan.github.io/scrabble/

GitHub’s current Pages workflow uses configure-pages, upload-pages-artifact, and deploy-pages, as configured in the repository. GitHub Pages workflow documentation.

## 11. Smoke-test production

1. Open https://gvensan.github.io/scrabble/.
2. Enter a nickname.
3. Select Play online with friends.
4. Create a room.
5. Open the invite URL in an incognito window or another device.
6. Join with another nickname.
7. Start the game as the host.
8. Confirm both players receive seven different private rack tiles.
9. Test tap placement and drag-and-drop.
10. Submit a valid word.
11. Refresh one browser and confirm it reconnects to the same private seat.
12. Test pass, exchange, theme switching, and leave.
13. Open https://gvensan.github.io/scrabble/#/adminit, sign in with ADMIN_TOKEN, and confirm the room appears.

## 12. Replace the bootstrap token with a narrower token

After squabble-worker exists, tighten the CI credential:

1. Create another Cloudflare custom API token.
2. Name it:

squabble-github-deploy

3. Grant:

Worker: squabble-worker
Role: Editor

In the legacy interface, use Workers Scripts → Edit, narrowed as much as the interface permits.

4. Replace the GitHub CLOUDFLARE_API_TOKEN secret with this new token.
5. Run the Worker workflow once to verify it.
6. Revoke the original squabble-github-bootstrap token.

Editor access is sufficient for updating an existing Worker and its secrets; Admin was needed only to create the Worker initially.

## Optional: authenticate Wrangler locally

For local manual administration, use Node 22 and Cloudflare OAuth:

cd /Users/girivenkatesan/gitmine/squabble
nvm install 22
nvm use 22
npx wrangler@latest login

A browser opens. Sign in to Cloudflare and select Allow. Then verify:

npx wrangler@latest whoami

OAuth credentials remain in Wrangler’s local credential storage and should not be copied into .env. Cloudflare’s documented flow is wrangler login, followed by wrangler deploy. Wrangler authentication instructions.