"""OpenAI client configuration for the restaurant chatbot."""

import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("OPENAI_API_KEY manquante dans le fichier .env")

client = OpenAI(api_key=api_key)

__all__ = ["client"]
