# Jarvis on WhatsApp — Twilio setup

## AWS deployment

The production webhook is `https://agrocooper.earth/api/whatsapp/webhook` (POST).
The app reads the Twilio settings from `/etc/nasa2026/ai-keys.env`, outside Git
and release directories. Keep `WHATSAPP_DB_PATH=/var/lib/nasa2026/whatsapp.sqlite3`
so queued messages and history survive releases. Use `WHATSAPP_DEMO_ANALYSIS=true`
for the labelled Young default-field example, and retain the tester allowlist.

To migrate from a local tunnel: install the settings with `WHATSAPP_ENABLED=false`,
deploy the integration through the main pipeline, enable WhatsApp and restart
`nasa2026-api`, then set the Sandbox's incoming webhook to the permanent URL.
Leave status callbacks separate. Test a real question from the joined phone
before stopping the old local gateway/tunnel. An unsigned POST should return
403 once enabled. Do not copy the local SQLite database or all local `.env`
variables to production; configure only this integration's required values.

Production uses the single worker in the existing service. Delivery failures
are not automatically resent; consult Twilio's delivery logs before retrying.

This local implementation reuses `app.jarvis.chat`, including its Groq models,
language detection and checks against invented numbers. WhatsApp receives text;
the website retains its synchronized voice and 3D visualizations. Website analyses
and conversations are not automatically shared with a phone number. Until a
secure account-linking flow is built, WhatsApp explains Cooper and agricultural
concepts without claiming to know the user's field results.

## Start with the Sandbox

New trial accounts must use Twilio One Console's Try out WhatsApp flow. Do not
redirect new users to the classic Sandbox even if its activation page can still
be opened: Twilio documents the classic Sandbox for legacy accounts, and new
trial signups cannot start a legacy trial. The two flows have separate numbers.
In One Console, Twilio's receive-message guide puts webhook settings under
Receive a message (or Inbound) → Auto-Reply → Custom. Its trial guide also
documents restrictions on custom outbound REST messages. This adapter uses
free-form REST replies, so do not claim that it is compatible with a new trial
until an end-to-end test succeeds. A legacy Sandbox or fully enabled sender is
the original supported target. A successful default reply only proves Twilio
received a message; it does not prove Jarvis is connected.

References: [current Sandbox availability](https://www.twilio.com/docs/whatsapp/sandbox),
[legacy trial transition](https://www.twilio.com/docs/usage/trials/legacy-console-trial-transition),
[new trial receiving guide](https://help.twilio.com/articles/55716571409819-How-do-I-receive-WhatsApp-messages-while-testing).

1. Create/sign into your own [Twilio account](https://console.twilio.com/).
2. Open Messaging → Try it out → Send a WhatsApp message (WhatsApp Sandbox).
   Follow its instructions to join from each tester's phone.
3. On the server, install `backend/requirements.txt`. Put the variables from
   `backend/.env.example` in the server-only environment file. For the existing
   VM service that is `/etc/nasa2026/ai-keys.env`.
4. Set the Account SID and Auth Token from Twilio, `TWILIO_WHATSAPP_FROM` to the
   Sandbox's `whatsapp:+...` number, and `WHATSAPP_ALLOWED_SENDERS` to the exact
   comma-separated `whatsapp:+...` tester numbers. Empty means deny everyone.
5. Set `TWILIO_WHATSAPP_WEBHOOK_URL` to the exact public HTTPS callback URL,
   with no query string or trailing slash. Proposed production URL:
   `https://agrocooper.earth/api/whatsapp/webhook`. The deployed version must
   contain this code first; it is currently local only.
6. In Sandbox settings, set **When a message comes in** to that URL, method POST.
   Leave delivery-status callbacks separate. For local testing use a trusted
   HTTPS tunnel to the local backend and set the environment URL to that exact
   tunnel URL instead. Never disable signature verification.
7. Set `WHATSAPP_DB_PATH=/var/lib/nasa2026/whatsapp.sqlite3` on the VM, so queue
   and history survive release changes. Set `WHATSAPP_ENABLED=true`, then restart
   the backend. Locally the default is `backend/data/whatsapp.sqlite3` when
   launched from `backend/`.
8. Send “How does Cooper work?”, then a follow-up. `/reset` or `/forget` clears
   the conversation. Check Twilio message logs if a reply does not arrive.

## Operation and limits

### Default-field demo analysis

Set `WHATSAPP_DEMO_ANALYSIS=true` only for the local gateway to let Jarvis answer
questions using `data/whatsapp-default-analysis.json`. The snapshot uses the
website's initial sample: near Young (-32.62, -57.75), 100 ha, continuous soybean,
no livestock, 120 mm soil water storage, priorities water 3 / soil 4 / income 4 /
forage 1 / climate 3, with no climate scenario. Its results were calculated by
Cooper from the cached 1996–2025 NASA POWER and SRTM data. They are fixed demo
results, not a live analysis of the person messaging. Every model reply gets a
demo label; the model also receives that distinction as a system instruction.

Demo conversations have their own history, separate from general chat. `/reset`
and `/forget` clear both histories. Turning the flag off restores context-free
chat. Changing inputs by message does not recalculate the snapshot. There is
still no browser/account linking. Rebuild the fixture offline after relevant
engine/default changes with `python scripts/generate_whatsapp_demo.py` from the
repository root; it requires the default field's existing NASA cache and fails
instead of downloading missing data.

Try “What inputs does this example use?”, “Which rotation has the best total
score?”, “How much soil does continuous soybean lose?”, or “Which option saves
the most water?”. The normal Jarvis numeric grounding checks still apply.

For a temporary local HTTPS tunnel, run the webhook-only app:

```powershell
cd backend
python -m uvicorn app.whatsapp_gateway:app --host 127.0.0.1 --port 8083 --no-access-log
```

Point the tunnel at `http://127.0.0.1:8083`, not the full website's port. This app
only exposes `/api/whatsapp/webhook`; docs, analysis and website routes return
404. Put the tunnel's exact HTTPS callback URL into the private environment
and Twilio Sandbox settings. A temporary tunnel URL changes when restarted.
Keep the main local website's environment `WHATSAPP_ENABLED=false`; enable it
only for the gateway process to avoid two workers sharing a local queue.

- The webhook validates Twilio's signature with its official SDK, configured
  HTTPS URL, account, destination and tester allowlist. Phone numbers are not
  included in the model prompt. Keep credentials and the SQLite file private.
- Signed text messages are committed to SQLite before the webhook acknowledges
  them. The backend worker sends the reply with Twilio's REST API, so model
  latency does not make the inbound webhook wait. Message SIDs suppress duplicate
  callbacks for 24 hours. Five accepted questions per sender per minute limits
  model spending. The allowlist is mandatory for this first version.
- Run **one Uvicorn worker on one machine**, as in the existing VM service.
  Histories retain at most 12 turns and expire after 24 hours. Expired records
  are removed by the worker or next accepted webhook; sent job bodies are cleared.
- A worker interrupted after claiming a job leaves it `processing`. Delivery
  failures are marked `failed`. Neither is resent automatically because an
  ambiguous REST failure could otherwise send duplicate WhatsApp messages.
  Inspect Twilio logs and ask the tester to send a new question. This is a
  prototype queue, not a guaranteed-delivery messaging service.
- Text only: attachments/voice notes get a helpful response. No scheduled or
  unsolicited messages, report playback, 3D visuals, analysis sharing, or analysis
  execution from WhatsApp in this version; the optional fixed demo above is the
  only analysis context supplied by this adapter. Replies use the same brief Jarvis
  style. A Twilio account and Groq key are required for a live end-to-end test.
- Twilio/WhatsApp messaging can incur charges. Check your account pricing and
  limits before enabling; no paid account or sender has been created by this work.
- Messages pass through WhatsApp/Twilio and conversation text is sent to Groq,
  just as website chat text is. Tell testers this before inviting them. `/forget`
  removes local conversation history; it cannot erase provider-side records.

Official references: [WhatsApp quickstart](https://www.twilio.com/docs/whatsapp/quickstart),
[incoming webhooks](https://www.twilio.com/docs/messaging/guides/webhook-request),
[signature validation](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
