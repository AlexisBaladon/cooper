# Jarvis on WhatsApp — Twilio setup

This local implementation reuses `app.jarvis.chat`, including its Groq models,
language detection and checks against invented numbers. WhatsApp receives text;
the website retains its synchronized voice and 3D visualizations. Website analyses
and conversations are not automatically shared with a phone number. Until a
secure account-linking flow is built, WhatsApp explains Cooper and agricultural
concepts without claiming to know the user's field results.

## Start with the Sandbox

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
  execution from WhatsApp in this version. Replies use the same brief Jarvis
  style. A Twilio account and Groq key are required for a live end-to-end test.
- Twilio/WhatsApp messaging can incur charges. Check your account pricing and
  limits before enabling; no paid account or sender has been created by this work.
- Messages pass through WhatsApp/Twilio and conversation text is sent to Groq,
  just as website chat text is. Tell testers this before inviting them. `/forget`
  removes local conversation history; it cannot erase provider-side records.

Official references: [WhatsApp quickstart](https://www.twilio.com/docs/whatsapp/quickstart),
[incoming webhooks](https://www.twilio.com/docs/messaging/guides/webhook-request),
[signature validation](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
