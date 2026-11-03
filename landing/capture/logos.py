#!/usr/bin/env python3
"""Copies the logos the app itself uses (src/utils/appLogo.ts, shared/modelProviders.ts, shared/mcpCatalog.ts) into
landing/assets/logos as plain SVG files, and writes logos.json (name, file, row). Run from the repository root:
    python3 landing/capture/logos.py"""
import json, os, re
R = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = f'{R}/landing/assets/logos'; os.makedirs(OUT, exist_ok=True)
sets = {c: json.load(open(f'{R}/node_modules/@iconify-json/{c}/icons.json')) for c in ('logos', 'simple-icons')}

def iconify(coll, name):
    d = sets[coll]; ic = d['icons'][name]; w = ic.get('width', d['width']); h = ic.get('height', d['height'])
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{ic["body"]}</svg>'

def brand(name):
    s = open(f'{R}/src/assets/brands/{name}.svg').read()
    s = re.sub(r'<title>.*?</title>', '', s); s = re.sub(r'\s(height|width)="1em"|\sstyle="[^"]*"', '', s)
    return s.replace('fill="currentColor"', '')

# (label, source, row) - row "a": apps and tools, row "b": model providers and MCP servers
APPS = [('Gmail','logos:google-gmail'),('Google Calendar','simple-icons:googlecalendar'),('Google Drive','logos:google-drive'),('Google Sheets','simple-icons:googlesheets'),('Google Docs','simple-icons:googledocs'),('Google Tasks','simple-icons:googletasks'),
 ('Slack','logos:slack-icon'),('GitHub','brand:github'),('Notion','simple-icons:notion'),('Linear','logos:linear-icon'),('Jira','logos:jira'),('GitLab','simple-icons:gitlab'),('Trello','simple-icons:trello'),('Asana','logos:asana-icon'),('ClickUp','logos:clickup-icon'),
 ('Airtable','logos:airtable'),('Salesforce','logos:salesforce'),('HubSpot','logos:hubspot'),('Zendesk','logos:zendesk-icon'),('Stripe','logos:stripe'),('Discord','logos:discord-icon'),
 ('Microsoft Teams','logos:microsoft-teams'),('Microsoft','logos:microsoft-icon'),('OneDrive','logos:microsoft-onedrive'),('SharePoint','simple-icons:microsoftsharepoint'),('OneNote','simple-icons:microsoftonenote'),('Excel','simple-icons:microsoftexcel'),('Word','simple-icons:microsoftword'),('PowerPoint','simple-icons:microsoftpowerpoint'),('Power BI','logos:microsoft-power-bi'),
 ('Canva','simple-icons:canva'),('Figma','logos:figma')]
MODELS = [('OpenAI','brand:openai'),('Anthropic','brand:claude-color'),('Google Gemini','brand:gemini-color'),('OpenRouter','brand:openrouter'),('Groq','brand:groq'),('Mistral','brand:mistral-color'),('DeepSeek','brand:deepseek-color'),('Kimi','brand:moonshot'),('Qwen','brand:qwen-color'),('xAI','brand:xai'),('Together AI','brand:together-color'),('Fireworks AI','brand:fireworks'),('Cerebras','brand:cerebras-color'),('Z.ai','brand:zhipu-color'),('Perplexity','brand:perplexity-color'),
 ('Google','brand:google-color')]
man = {'a': [], 'b': []}
for row, items in (('a', APPS), ('b', MODELS)):
    for label, src in items:
        kind, name = src.split(':', 1) if not src.startswith('simple-icons') else ('simple-icons', src.split(':', 1)[1])
        if src.startswith('logos:'): svg = iconify('logos', src[6:]); slug = src[6:]
        elif src.startswith('simple-icons:'): svg = iconify('simple-icons', src[13:]); slug = src[13:]
        else: svg = brand(src[6:]); slug = src[6:]
        open(f'{OUT}/{slug}.svg', 'w').write(svg); man[row].append({'name': label, 'file': f'{slug}.svg'})
json.dump(man, open(f'{OUT}/logos.json', 'w'), indent=1)
print({k: len(v) for k, v in man.items()})
