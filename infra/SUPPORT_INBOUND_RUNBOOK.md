# Support Email-to-Ticket — Inbound Setup Runbook

Stands up **real inbound email** for the support system. The app code (webhook, parser, routing, public page, internal UI) is already deployed; this wires AWS SES → the webhook and points DNS at it. **You run this with your own `aws` session** (or short-lived STS creds) — no long-lived keys needed.

> Region: deploy in an **SES inbound region** — `us-east-1` (recommended), `us-west-2`, or `eu-west-1`. The app itself can stay in ap-south-1; SNS delivers to the public HTTPS API.

## One-time prerequisites (≈2 min, console or CLI)
1. **Verify the helpdesk domain in SES** (so SES will accept mail for it) — in the chosen region:
   ```bash
   aws ses verify-domain-identity --domain helpdesk.prop-vantage.com --region us-east-1
   ```
   Add the returned TXT record to Route 53 (`_amazonses.helpdesk.prop-vantage.com`). (If you want to *send* as `…@helpdesk.prop-vantage.com` through SES too, also run `verify-domain-dkim` and add the 3 CNAMEs; outbound currently goes through the app's existing SMTP, so this is optional for inbound.)
2. Find your Route 53 hosted zone ID for `prop-vantage.com`:
   ```bash
   aws route53 list-hosted-zones-by-name --dns-name prop-vantage.com --query 'HostedZones[0].Id' --output text
   ```

## Deploy — one command
```bash
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name propvantage-support-inbound \
  --template-file infra/support-inbound-ses.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      HelpdeskDomain=helpdesk.prop-vantage.com \
      WebhookUrl=https://api.prop-vantage.com/api/support/inbound/ses \
      HostedZoneId=<ZONE_ID_FROM_STEP_2> \
      SesInboundHost=inbound-smtp.us-east-1.amazonaws.com
```
This creates: the SNS topic + policy, the HTTPS subscription to the webhook (the app auto-confirms it), the SES receipt rule set + rule (helpdesk domain → SNS, full message Base64), and the Route 53 **MX / SPF / DMARC** records.

## Activate the rule set (one line — SES rule-set activation isn't a CFN op)
```bash
aws ses set-active-receipt-rule-set --rule-set-name propvantage-support --region us-east-1
```
(The exact command is also in the stack's `PostDeploy` output.)

## App-side config (env on the API + per-org inbox)
1. Set on the API (already supported by the code):
   - `PUBLIC_TICKET_BASE_URL=https://www.prop-vantage.com` (used to build the `/t/<token>` link in client emails; falls back to `CLIENT_URL`).
   - `SUPPORT_TEST_SECRET=<random>` (gates the test-ingest adapter in production; not needed for SES).
2. **Map each org's helpdesk address → org** (this is how multi-tenant routing stays unambiguous — the webhook routes by the *recipient* address). Create a `SupportInbox` row per org, e.g. for 25 South:
   ```js
   // one-off (admin script / mongosh): address is the public helpdesk address you give that org's clients
   db.supportinboxes.insertOne({ organization: ObjectId('<25SOUTH_ORG_ID>'), address: '25south@helpdesk.prop-vantage.com', active: true, createdAt: new Date(), updatedAt: new Date() })
   ```
   Then tell that developer to give clients **`25south@helpdesk.prop-vantage.com`** (or forward their branded `helpdesk@25south.com` → it). Each org gets a distinct local-part; collisions are impossible.

## Test it
- **Without DNS (any time):** the internal loop is exercisable via the owner-only **"Simulate inbound"** button on `/support`, or `POST /api/support/ingest-test`.
- **End-to-end (after the above):** send a real email to `25south@helpdesk.prop-vantage.com` with subject `Legal - test`. Within ~1 min a ticket appears under **Tickets**, the sender gets an auto-reply with a `/t/<token>` link, and the Legal Head is notified. Replying to that email (subject keeps `[TKT-####]`) threads back onto the ticket.

## Notes / hardening
- SNS action delivers the full message inline up to its size limit; for very large emails/attachments add an **S3 action** + fetch-from-S3 in the `ses` adapter (left as a Phase-2 enhancement).
- The webhook verifies the SNS `SigningCertURL` host; for stricter security add full SNS signature verification (documented in `services/support/inbound/ses.js`).
- Teardown: `aws cloudformation delete-stack --stack-name propvantage-support-inbound --region us-east-1` (deactivate the rule set first).
