"""Webhook-only app for temporary local tunnels. No website or analysis endpoints.

Run from backend/: uvicorn app.whatsapp_gateway:app --host 127.0.0.1 --port 8083
Do not enable WhatsApp on another local backend against the same queue.
"""
from fastapi import FastAPI
from . import whatsapp

app = FastAPI(title='Cooper WhatsApp gateway', docs_url=None, redoc_url=None,
              openapi_url=None, lifespan=whatsapp.lifespan)
app.include_router(whatsapp.router)
