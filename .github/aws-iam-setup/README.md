# GitHub Actions deploy — one-time AWS setup

The workflow at `.github/workflows/deploy.yml` uses **GitHub OIDC** to assume an AWS IAM role on every run. No long-lived AWS access keys are stored in GitHub secrets — short-lived tokens are minted per workflow run and expire automatically.

This document covers the three one-time steps you need to do in the AWS Console (or via CLI) before the workflow will succeed.

## Step 1 — Create the GitHub OIDC identity provider

This tells AWS to trust tokens signed by GitHub Actions.

**Console:**
1. IAM → Identity providers → Add provider
2. Provider type: **OpenID Connect**
3. Provider URL: `https://token.actions.githubusercontent.com`
   - Click **Get thumbprint**
4. Audience: `sts.amazonaws.com`
5. Add provider

**CLI equivalent:**
```sh
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

(AWS now validates the thumbprint server-side, so the value above is conventional. If you've already done this for any other repo in account `854781667410`, skip this step — the provider is account-wide.)

## Step 2 — Create the deploy role

**Console:**
1. IAM → Roles → Create role
2. Trusted entity type: **Web identity**
3. Identity provider: `token.actions.githubusercontent.com`
4. Audience: `sts.amazonaws.com`
5. GitHub organization: `Scaleupapp-nirpeksh`
6. GitHub repository: `propvantage-ai-backend`
7. GitHub branch: `main`
8. Next → skip attaching policies for now (we'll attach inline next) → name the role `github-actions-deploy-propvantage` → Create

After creation, **replace the trust policy** with the contents of `trust-policy.json` in this folder. (The Console wizard creates a workable trust policy, but the one in this repo pins it explicitly to the `main` branch via `StringLike` on the `sub` claim — same effect, just version-controlled.)

**CLI equivalent:**
```sh
aws iam create-role \
  --role-name github-actions-deploy-propvantage \
  --assume-role-policy-document file://.github/aws-iam-setup/trust-policy.json
```

## Step 3 — Attach the minimal permissions policy

The workflow needs exactly two permissions: `ec2:DescribeInstances` (to look up the public DNS) and `ec2-instance-connect:SendSSHPublicKey` (to push the ephemeral SSH key, scoped to the prop-vantage instance + `ec2-user` only).

**Console:**
1. Open the role `github-actions-deploy-propvantage`
2. Permissions tab → Add permissions → Create inline policy
3. JSON editor → paste the contents of `permissions-policy.json` in this folder
4. Name: `deploy-via-instance-connect` → Create

**CLI equivalent:**
```sh
aws iam put-role-policy \
  --role-name github-actions-deploy-propvantage \
  --policy-name deploy-via-instance-connect \
  --policy-document file://.github/aws-iam-setup/permissions-policy.json
```

## Step 4 — Add the role ARN to GitHub repo secrets

1. Copy the role ARN: `arn:aws:iam::854781667410:role/github-actions-deploy-propvantage`
2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret
3. Name: `AWS_DEPLOY_ROLE_ARN`
4. Value: paste the role ARN
5. Save

## Step 5 — Test it

Push any small commit to `main` (or run the workflow manually: Actions tab → "Deploy to EC2" → Run workflow). The workflow will:
1. Assume the OIDC role
2. Resolve the EC2 public DNS
3. Push an ephemeral SSH key (60s validity) via Instance Connect
4. SSH in, `git pull`, `pm2 restart propvantage-api`
5. Curl the public health endpoint until it returns 200, fail if it doesn't within ~25s

You can watch the run live in the Actions tab.

## What gets locked down by this setup

- **No AWS access keys in GitHub.** GitHub mints a short-lived OIDC token, AWS verifies it, and issues a 1-hour STS credential scoped to this single role.
- **Role can only be assumed from this repo + this branch.** Trust policy `sub` condition is pinned to `repo:Scaleupapp-nirpeksh/propvantage-ai-backend:ref:refs/heads/main`. A fork or feature branch cannot assume it.
- **Role can only touch the prop-vantage EC2 instance.** Permissions are scoped to `arn:aws:ec2:ap-south-1:854781667410:instance/i-0dfec8426e507aa00` and `ec2:osuser=ec2-user`. The role cannot push keys to other instances or as other users.
- **No SSH private key stored anywhere persistent.** Each workflow run generates a fresh keypair, uses it for 60 seconds, and discards it on cleanup.
