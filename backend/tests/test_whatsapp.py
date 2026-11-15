"""No network or real credentials: signed callbacks and worker delivery contracts."""
import pytest
import json
from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator
from app import main, whatsapp
from app.whatsapp_gateway import app as gateway

URL = 'https://example.com/api/whatsapp/webhook'
FROM = 'whatsapp:+59899123456'
TO = 'whatsapp:+14155238886'


def test_gateway_only_exposes_webhook(monkeypatch):
    monkeypatch.setenv('WHATSAPP_ENABLED', 'false')
    with TestClient(gateway) as client:
        assert client.post('/api/whatsapp/webhook').status_code == 503
        for route in ('/', '/docs', '/openapi.json', '/api/jarvis/chat', '/api/analyze'):
            assert client.get(route).status_code == 404


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.delenv('WHATSAPP_DEMO_ANALYSIS', raising=False)
    for key, value in {
        'WHATSAPP_ENABLED': 'true', 'TWILIO_AUTH_TOKEN': 'test-token',
        'TWILIO_ACCOUNT_SID': 'ACtest', 'TWILIO_WHATSAPP_FROM': TO,
        'TWILIO_WHATSAPP_WEBHOOK_URL': URL,
        'WHATSAPP_DB_PATH': str(tmp_path / 'messages.sqlite3'),
    }.items():
        monkeypatch.setenv(key, value)
    return TestClient(main.app)  # No lifespan: tests advance the worker explicitly.


def send(client, sid='SMtest', **extra):
    data = dict(AccountSid='ACtest', From=FROM, To=TO, MessageSid=sid, Body='Explain soil', NumMedia='0')
    data.update(extra)
    signature = RequestValidator('test-token').compute_signature(URL, data)
    return client.post('/api/whatsapp/webhook', data=data, headers={'X-Twilio-Signature': signature})


def test_disabled_and_bad_signatures(client, monkeypatch):
    assert client.post('/api/whatsapp/webhook', data={'Body': 'fake'}).status_code == 403
    monkeypatch.setenv('WHATSAPP_ENABLED', 'false')
    assert send(client).status_code == 503


def test_signed_dedup_and_access(client):
    assert send(client).text == whatsapp.EMPTY
    assert send(client).status_code == 200
    assert send(client, sid='SMother', From='whatsapp:+15551234567').text == whatsapp.EMPTY  # any number may write
    assert send(client, sid='SMbad', From='+15551234567').status_code == 400
    assert send(client, sid='SMacct', AccountSid='ACother').status_code == 403
    with whatsapp.database() as db:
        assert db.execute('SELECT count(*) FROM jobs').fetchone()[0] == 2


def test_media_length_and_rate_limit(client):
    assert 'text message' in send(client, NumMedia='1').text
    assert 'shorten' in send(client, Body='x' * 1501).text
    for i in range(5):
        assert send(client, sid=f'SM{i}').text == whatsapp.EMPTY
    assert 'wait a minute' in send(client, sid='SMlimit').text


def test_worker_reuses_jarvis_history_and_reset(client, monkeypatch):
    calls, deliveries = [], []
    def chat(data):
        calls.append(data)
        return {'reply': 'Healthy soil helps crops.'}
    class Messages:
        def create(self, **kwargs):
            deliveries.append(kwargs)
    class Twilio:
        messages = Messages()
        def __init__(self, *args):
            pass
    monkeypatch.setattr(whatsapp.jarvis, 'chat', chat)
    monkeypatch.setattr(whatsapp, 'Client', Twilio)
    send(client)
    whatsapp.process_one()
    whatsapp.process_one()
    assert len(deliveries) == 1
    assert deliveries[0]['to'] == FROM
    assert calls[0]['context'] is None
    assert FROM not in str(calls)
    send(client, sid='SMtwo', Body='And water?')
    whatsapp.process_one()
    assert calls[1]['messages'][1]['role'] == 'assistant'
    send(client, sid='SMreset', Body='/reset')
    whatsapp.process_one()
    with whatsapp.database() as db:
        assert db.execute('SELECT count(*) FROM conversations').fetchone()[0] == 0


def test_delivery_failure_is_not_retried(client, monkeypatch):
    monkeypatch.setattr(whatsapp.jarvis, 'chat', lambda _: {'reply': 'Reply'})
    class Broken:
        def __init__(self, *args):
            raise RuntimeError('delivery failed')
    monkeypatch.setattr(whatsapp, 'Client', Broken)
    send(client)
    whatsapp.process_one()
    whatsapp.process_one()
    with whatsapp.database() as db:
        row = db.execute('SELECT state,body FROM jobs').fetchone()
        assert tuple(row) == ('failed', '')


def test_demo_uses_fixed_context_labels_reply_and_isolates_history(client, monkeypatch):
    calls, replies = [], []
    def chat(data):
        calls.append(data)
        return {'reply': 'The example covers 100 hectares.', 'lang': 'en'}
    class Twilio:
        def __init__(self, *args):
            self.messages = self
        def create(self, **kwargs):
            replies.append(kwargs['body'])
    monkeypatch.setattr(whatsapp.jarvis, 'chat', chat)
    monkeypatch.setattr(whatsapp, 'Client', Twilio)
    send(client, Body='General question')
    whatsapp.process_one()
    monkeypatch.setenv('WHATSAPP_DEMO_ANALYSIS', 'true')
    send(client, sid='SMdemo', Body='What is the size of this example?')
    whatsapp.process_one()
    assert len(calls[1]['messages']) == 1  # No generic-session history leaks into demo.
    assert calls[1]['context']['demo'] is True
    assert calls[1]['context']['inputs']['field_size_ha'] == 100
    assert replies[1].startswith('Demo analysis (Young sample): ')
    send(client, sid='SMforget', Body='/forget')
    whatsapp.process_one()
    with whatsapp.database() as db:
        assert db.execute('SELECT count(*) FROM conversations').fetchone()[0] == 0


def test_snapshot_matches_website_defaults_and_fits_prompt():
    fixture = json.loads(whatsapp.DEMO_PATH.read_text(encoding='utf-8'))
    defaults = fixture['input']
    assert defaults['lat'] == -32.62 and defaults['lon'] == -57.75
    assert defaults['prioridades'] == dict(agua=3, suelo=4, ingreso=4, forraje=1, clima=3)
    ctx = fixture['context']
    assert len(json.dumps(ctx, ensure_ascii=False, separators=(',', ':'))) < whatsapp.jarvis.MAX_CONTEXT_CHARS
    assert len(ctx['climate']['rain_mm']) == len(ctx['climate']['et0_mm']) == 12
    assert ctx['rotations'][0]['id'] == 'soja_continua'
    assert len(ctx['rotations']) == 3 and ctx['ranking']
    assert all(0 <= r['total'] <= 100 for r in ctx['ranking'])
    assert 'lat' not in ctx and 'lon' not in ctx


def test_demo_model_prompt_and_number_grounding(monkeypatch):
    monkeypatch.setenv('WHATSAPP_DEMO_ANALYSIS', 'true')
    context = whatsapp.demo_context()
    def completion(payload, models):
        assert 'fixed DEMO analysis' in payload['messages'][0]['content']
        return json.dumps({'segments':[{'say':'The example is 100 hectares.', 'show':'field'},
                                       {'say':'You will earn 999999 dollars.'}]}), 'mock'
    monkeypatch.setattr(whatsapp.jarvis, '_completion', completion)
    result = whatsapp.jarvis.chat({'messages':[{'role':'user','content':'Describe the example.'}], 'context':context})
    assert '100 hectares' in result['reply']
    assert '999999' not in result['reply']
