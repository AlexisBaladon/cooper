"""Signed Twilio webhook and durable, single-machine WhatsApp reply queue.

Phone numbers never enter the model prompt. No browser analysis is shared implicitly.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import sqlite3
import time
import asyncio
from contextlib import contextmanager, asynccontextmanager, suppress
from urllib.parse import parse_qs

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.datastructures import FormData
from twilio.request_validator import RequestValidator
from twilio.rest import Client

from . import jarvis

router = APIRouter()
log = logging.getLogger(__name__)
EMPTY = '<Response></Response>'


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(worker())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def enabled():
    return os.getenv('WHATSAPP_ENABLED', '').lower() == 'true'


@contextmanager
def database():
    path = Path(os.getenv('WHATSAPP_DB_PATH', 'data/whatsapp.sqlite3'))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=5)
    db.row_factory = sqlite3.Row
    db.executescript('''
        CREATE TABLE IF NOT EXISTS jobs (
          sid TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL,
          body TEXT NOT NULL, created REAL NOT NULL, state TEXT NOT NULL DEFAULT 'queued');
        CREATE TABLE IF NOT EXISTS conversations (
          sender TEXT PRIMARY KEY, history TEXT NOT NULL, updated REAL NOT NULL);
    ''')
    try:
        with db:
            yield db
    finally:
        db.close()


@router.post('/api/whatsapp/webhook')
async def webhook(request: Request):
    if not enabled():
        raise HTTPException(503, 'WhatsApp is not configured')
    token = os.getenv('TWILIO_AUTH_TOKEN', '')
    url = os.getenv('TWILIO_WHATSAPP_WEBHOOK_URL', '')
    account = os.getenv('TWILIO_ACCOUNT_SID', '')
    sender = os.getenv('TWILIO_WHATSAPP_FROM', '')
    if not all((token, url.startswith('https://'), account, sender)):
        raise HTTPException(503, 'WhatsApp is not configured')
    if request.url.query or request.headers.get('content-type', '').split(';')[0] != 'application/x-www-form-urlencoded':
        raise HTTPException(400, 'Expected a form without query parameters')
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 32768:
            raise HTTPException(413, 'Message too large')
    try:
        values = parse_qs(raw.decode('utf-8'), keep_blank_values=True, max_num_fields=100)
    except (UnicodeError, ValueError):
        raise HTTPException(400, 'Invalid form') from None
    form = FormData([(key, v) for key, items in values.items() for v in items])
    if not RequestValidator(token).validate(url, form, request.headers.get('x-twilio-signature', '')):
        raise HTTPException(403, 'Invalid signature')
    if any(len(v) != 1 for v in values.values()):
        raise HTTPException(400, 'Duplicate fields')
    if form.get('AccountSid') != account or form.get('To') != sender:
        raise HTTPException(403, 'Unexpected sender account')
    source, sid = form.get('From', ''), form.get('MessageSid', '')
    if not source.startswith('whatsapp:+') or not sid or len(sid) > 64:
        raise HTTPException(400, 'Invalid message')
    allow = [x.strip() for x in os.getenv('WHATSAPP_ALLOWED_SENDERS', '').split(',') if x.strip()]
    if not allow or source not in allow:
        raise HTTPException(403, 'Sender not enabled')
    body = form.get('Body', '').strip()
    if form.get('NumMedia', '0') != '0' or not body:
        return Response('<Response><Message>Please send a text message. Voice notes and attachments are not supported yet.</Message></Response>', media_type='application/xml')
    if len(body) > 1500:
        return Response('<Response><Message>Please shorten your message to 1500 characters.</Message></Response>', media_type='application/xml')
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        now = time.time()
        db.execute('DELETE FROM jobs WHERE created < ? AND state != ?', (now - 86400, 'processing'))
        db.execute('DELETE FROM conversations WHERE updated < ?', (now - 86400,))
        if db.execute('SELECT 1 FROM jobs WHERE sid=?', (sid,)).fetchone():
            return Response(EMPTY, media_type='application/xml')
        if db.execute('SELECT count(*) FROM jobs WHERE sender=? AND created>?', (source, now - 60)).fetchone()[0] >= 5:
            return Response('<Response><Message>Please wait a minute before sending more questions.</Message></Response>', media_type='application/xml')
        db.execute('INSERT INTO jobs(sid,sender,recipient,body,created) VALUES(?,?,?,?,?)', (sid, source, sender, body, now))
    return Response(EMPTY, media_type='application/xml')


def process_one():
    """Atomically claim one job; never automatically resend an ambiguous delivery."""
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM jobs WHERE created < ?', (time.time() - 86400,))
        db.execute('DELETE FROM conversations WHERE updated < ?', (time.time() - 86400,))
        row = db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created,rowid LIMIT 1").fetchone()
        if not row:
            return
        db.execute("UPDATE jobs SET state='processing' WHERE sid=?", (row['sid'],))
    source = row['sender']
    with database() as db:
        previous = db.execute('SELECT history FROM conversations WHERE sender=? AND updated>?', (source, time.time() - 86400)).fetchone()
    history = json.loads(previous['history']) if previous else []
    reset = row['body'].lower() in ('/reset', '/forget')
    if reset:
        history = []
        reply = 'Conversation cleared. Ask me about Cooper, crop rotations, water or soil.'
    else:
        history.append({'role': 'user', 'content': row['body']})
        try:
            reply = jarvis.chat({'messages': history[-12:], 'context': None})['reply']
        except Exception:
            # Do not log exception bodies: providers may include message contents.
            reply = 'Jarvis could not answer right now. Please try again shortly.'
    reply = reply[:1500]
    try:
        Client(os.environ['TWILIO_ACCOUNT_SID'], os.environ['TWILIO_AUTH_TOKEN']).messages.create(
            from_=row['recipient'], to=source, body=reply)
    except Exception:
        with database() as db:
            db.execute("UPDATE jobs SET state='failed',body='' WHERE sid=?", (row['sid'],))
        log.warning('WhatsApp delivery failed; inspect Twilio delivery logs (no automatic resend).')
        return
    with database() as db:
        if reset:
            db.execute('DELETE FROM conversations WHERE sender=?', (source,))
        else:
            history.append({'role': 'assistant', 'content': reply})
            db.execute('INSERT OR REPLACE INTO conversations VALUES(?,?,?)', (source, json.dumps(history[-12:]), time.time()))
        db.execute("UPDATE jobs SET state='sent',body='' WHERE sid=?", (row['sid'],))


async def worker():
    while True:
        if enabled():
            try:
                await asyncio.to_thread(process_one)
            except Exception:
                log.warning('WhatsApp worker unavailable; check database configuration.')
        await asyncio.sleep(1)
