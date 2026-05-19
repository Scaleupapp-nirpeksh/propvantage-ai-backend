# GitHub Actions deploy — AWS setup

The deploy workflow at `.github/workflows/deploy.yml` uses **GitHub OIDC** to assume an IAM role on every run, then drives the deploy via **AWS Systems Manager (SSM) Run Command** — no SSH, no long-lived keys, no Instance Connect dance.

**All AWS infrastructure has already been provisioned in account `854781667410` / `ap-south-1`** — this document records what exists and how to recreate it if needed.

## What's already deployed

| Resource | Identifier |
|---|---|
| GitHub OIDC provider | `arn:aws:iam::854781667410:oidc-provider/token.actions.githubusercontent.com` |
| GitHub Actions deploy role | `github-actions-deploy-propvantage` |
| Deploy role ARN (used in workflow) | `arn:aws:iam::854781667410:role/github-actions-deploy-propvantage` |
| Trust policy | Pinned to `repo:Scaleupapp-nirpeksh/propvantage-ai-backend:*` (all refs in this repo) |
| Inline permissions policy | `deploy-via-ssm` — `ec2:DescribeInstances`, `ssm:SendCommand` (scoped to `i-0dfec8426e507aa00`), `ssm:GetCommandInvocation`, `ssm:ListCommandInvocations` |
| SSM instance role on EC2 | `propvantage-ec2-ssm` with `AmazonSSMManagedInstanceCore` |
| SSM instance profile attached to `i-0dfec8426e507aa00` | Yes (association `iip-assoc-0d2c4d13771affbbd`) |
| SSM agent on `i-0dfec8426e507aa00` | `Online` (agent 3.3.2299.0) |
| GitHub repo secret `AWS_DEPLOY_ROLE_ARN` | Set |

## How it works at runtime

```
push to main
   ↓
GitHub Actions runner
   ↓ (mints short-lived OIDC token)
sts:AssumeRoleWithWebIdentity → 1-hour STS credential for `github-actions-deploy-propvantage`
   ↓
aws ssm send-command --instance-id i-0dfec8426e507aa00 \
    --document-name AWS-RunShellScript \
    --parameters '{commands: [git pull && pm2 restart ...]}'
   ↓
SSM agent on EC2 runs the script (as root)
   ↓
aws ssm wait command-executed → fetch StandardOutputContent
   ↓
curl https://api.prop-vantage.com/api/health → must return 200
```

No SSH key is ever generated. No AWS key sits in GitHub secrets. The 1-hour STS credential is scoped to one instance + a handful of SSM actions.

## To recreate from scratch (if anything is ever deleted)

The CLI commands below assume `AWS_REGION=ap-south-1` and credentials that can manage IAM + SSM.

### 1. OIDC provider
```sh
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 2. SSM instance profile role
```sh
aws iam create-role --role-name propvantage-ec2-ssm \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]
  }'
aws iam attach-role-policy --role-name propvantage-ec2-ssm \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name propvantage-ec2-ssm
aws iam add-role-to-instance-profile \
  --instance-profile-name propvantage-ec2-ssm --role-name propvantage-ec2-ssm

aws ec2 associate-iam-instance-profile \
  --instance-id i-0dfec8426e507aa00 \
  --iam-instance-profile Name=propvantage-ec2-ssm

# Then restart the SSM agent on the EC2 instance so it picks up credentials:
#   sudo systemctl restart amazon-ssm-agent
```

### 3. Deploy role (trust + permissions)
```sh
aws iam create-role --role-name github-actions-deploy-propvantage \
  --assume-role-policy-document file://.github/aws-iam-setup/trust-policy.json
aws iam put-role-policy --role-name github-actions-deploy-propvantage \
  --policy-name deploy-via-ssm \
  --policy-document file://.github/aws-iam-setup/permissions-policy.json
```

### 4. GitHub repo secret
```sh
gh secret set AWS_DEPLOY_ROLE_ARN \
  --body "arn:aws:iam::854781667410:role/github-actions-deploy-propvantage"
```

## What this locks down

- **No AWS access keys in GitHub.** OIDC tokens are minted per workflow run, expire in 1 hour, and are scoped to this repo only.
- **Role can only be assumed from this repo.** Trust policy `sub` condition: `repo:Scaleupapp-nirpeksh/propvantage-ai-backend:*`. A fork or another repo cannot assume it.
- **Role can only touch the prop-vantage EC2 instance.** `ssm:SendCommand` is resource-scoped to `arn:aws:ec2:ap-south-1:854781667410:instance/i-0dfec8426e507aa00` only.
- **Role cannot execute arbitrary documents.** `SendCommand` is also scoped to the `AWS-RunShellScript` document; no Patch Manager, no Config Compliance, no custom docs.
- **No SSH key ever exists.** SSM agent runs as root on the box and is authenticated against AWS, not authorized via any local key.
- **Audit trail.** Every deploy command shows up in CloudTrail (`SendCommand` event) and SSM Run Command history with the full script body and stdout.
