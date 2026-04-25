import requests

payload = { 'api_key': '7d57cfb01cf86de4bfa24cadcc8cc2e1', 'url': 'https://examsmsuniv.com/dec25_results/show-dec25-online-exam-result' }
r = requests.get('https://api.scraperapi.com/', params=payload)
print(r.text)
