#!/usr/bin/env python3
"""Portable local Markdown vault UI. Run from your vault root: python app/server.py"""
import json, os, re, time, mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC=os.path.join(os.path.dirname(os.path.abspath(__file__)),"static")
PORT=int(os.environ.get("NOTES_PORT","8765"))
MD={".md",".markdown"}; TEXT=MD|{".txt",".bib",".tex",".json",".yaml",".yml",".py",".js",".html",".css",".sh"}
BIB=re.compile(r"@(\w+)\s*\{\s*([^,\s]+)\s*,",re.M)
WIKI=re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")
FIELDS=re.compile(r"^\s*(id|title|date|deadline|keywords|participants|category|topic|status|priority)\s*:\s*(.*?)\s*$",re.I|re.M)
def safe(rel):
 rel=unquote(rel).lstrip('/\\'); p=os.path.abspath(os.path.join(ROOT,rel))
 if p!=ROOT and not p.startswith(ROOT+os.sep): raise ValueError('Path escapes vault root')
 return p
def rel(p): return os.path.relpath(p,ROOT).replace(os.sep,'/')
def textfile(p): return os.path.splitext(p)[1].lower() in TEXT
def read(p):
 with open(p,encoding='utf-8',errors='replace') as f:return f.read()
def write(p,s):
 os.makedirs(os.path.dirname(p),exist_ok=True); tmp=p+'.tmp'
 with open(tmp,'w',encoding='utf-8',newline='') as f:f.write(s)
 os.replace(tmp,p)
def metadata(s):
 m={k.lower():v.strip() for k,v in FIELDS.findall(s)}
 tm=re.search(r'^Tags\s*\n=+\s*(.*?)(?=^\S|\Z)',s,re.M|re.S)
 tags=[]
 if tm:
  for line in tm.group(1).splitlines():
   if ':' in line: tags += [x.strip() for x in re.split('[,;]',line.split(':',1)[1]) if x.strip()]
 m['tags']=sorted(set(tags))
 h=re.search(r'^#\s+(.+?)\s*$|^([^\n=]+)\n=+\s*$',s,re.M)
 if h:m.setdefault('title',(h.group(1) or h.group(2)).strip())
 return m
def all_notes():
 out=[]
 for cur,dirs,names in os.walk(ROOT):
  dirs[:]=sorted(d for d in dirs if not d.startswith('.') and d not in {'app','__pycache__'})
  for n in sorted(names):
   p=os.path.join(cur,n)
   if textfile(p):
    try:
     s=read(p); m=metadata(s); st=os.stat(p)
     out.append({'path':rel(p),'name':n,'directory':os.path.dirname(rel(p)),'title':m.get('title') or os.path.splitext(n)[0],'id':m.get('id',''),'date':m.get('date',''),'category':m.get('category',''),'topic':m.get('topic',''),'status':m.get('status',''),'priority':m.get('priority',''),'tags':m['tags'],'references':[{'type':a.lower(),'key':b} for a,b in BIB.findall(s)],'links':WIKI.findall(s),'modified':st.st_mtime,'size':st.st_size})
    except OSError:pass
 return out
def index_data():
 notes=all_notes(); by={n['path']:n for n in notes}
 lookup={}
 for n in notes:
  for key in (n['path'],n['name'],n['title'],n['id']):
   if key:lookup.setdefault(key.lower(),n['path'])
 for n in notes:
  n['resolved_links']=[];n['backlinks']=[]
 for n in notes:
  for link in n['links']:
   target=lookup.get(link.strip().lower())
   if target and target in by:n['resolved_links'].append(target);by[target]['backlinks'].append(n['path'])
 sets={k:{} for k in ('tags','statuses','categories','topics')}
 for n in notes:
  for tag in n['tags']:sets['tags'].setdefault(tag,[]).append(n['path'])
  for field,bucket in [('status','statuses'),('category','categories'),('topic','topics')]:
   if n[field]:sets[bucket].setdefault(n[field],[]).append(n['path'])
 return {'generated':time.time(),'notes':notes,**{k:dict(sorted(v.items(),key=lambda x:x[0].lower())) for k,v in sets.items()}}
def tree():
 def walk(p):
  node={'name':os.path.basename(p) or '.','path':rel(p),'type':'directory','children':[]}
  try: entries=sorted(os.scandir(p),key=lambda e:(not e.is_dir(),e.name.lower()))
  except OSError:return node
  for e in entries:
   if e.name.startswith('.') or e.name in {'app','__pycache__'}:continue
   if e.is_dir():node['children'].append(walk(e.path))
   elif textfile(e.path):node['children'].append({'name':e.name,'path':rel(e.path),'type':'file'})
  return node
 return walk(ROOT)
class Handler(BaseHTTPRequestHandler):
 server_version='VaultWorkbench/2.0'
 def log_message(self,*a):pass
 def sendj(self,status,data):
  b=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(b)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(b)
 def body(self):return json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))).decode() or '{}')
 def do_GET(self):
  u=urlparse(self.path);q=parse_qs(u.query)
  try:
   if u.path=='/':return self.static('index.html')
   if u.path.startswith('/static/'):return self.static(u.path[8:])
   if u.path=='/api/tree':return self.sendj(200,tree())
   if u.path=='/api/index':return self.sendj(200,index_data())
   if u.path=='/api/file':
    p=safe(q['path'][0])
    if not os.path.isfile(p):return self.sendj(404,{'error':'File not found'})
    s=read(p);return self.sendj(200,{'path':rel(p),'content':s,'metadata':metadata(s),'references':[{'type':a.lower(),'key':b} for a,b in BIB.findall(s)]})
   if u.path=='/api/search':
    qtext=q.get('q',[''])[0].lower().strip(); tag=q.get('tag',[''])[0].lower(); status=q.get('status',[''])[0].lower();cat=q.get('category',[''])[0].lower();topic=q.get('topic',[''])[0].lower();res=[]
    for n in all_notes():
     if tag and tag not in [x.lower() for x in n['tags']]:continue
     if status and n['status'].lower()!=status:continue
     if cat and n['category'].lower()!=cat:continue
     if topic and n['topic'].lower()!=topic:continue
     if qtext and qtext not in ' '.join([n['path'],n['title'],n['id'],n['date'],n['category'],n['topic'],n['status'],n['priority'],' '.join(n['tags']),read(safe(n['path']))]).lower():continue
     res.append(n)
    return self.sendj(200,{'count':len(res),'results':res})
   if u.path=='/api/references':
    refs=[]
    for n in all_notes():
     if not n['path'].startswith('info/'):continue
     for r in n['references']:refs.append({'path':n['path'],**r})
    return self.sendj(200,{'references':refs,'count':len(refs)})
   if u.path=='/api/templates':
    p=safe('templates'); vals=[]
    if os.path.isdir(p):vals=[{'name':n,'path':'templates/'+n} for n in sorted(os.listdir(p)) if os.path.isfile(os.path.join(p,n)) and textfile(n)]
    return self.sendj(200,vals)
   return self.sendj(404,{'error':'Unknown endpoint'})
  except Exception as e:return self.sendj(400,{'error':str(e)})
 def do_POST(self):
  try:
   d=self.body();route=urlparse(self.path).path
   if route=='/api/create':
    name=d.get('path','').strip()
    if not os.path.splitext(name)[1]:name+='.md'
    p=safe(name)
    if os.path.exists(p):return self.sendj(409,{'error':'File already exists'})
    tpl=d.get('template','');content=''
    if tpl:
     t=safe(tpl)
     if not os.path.isfile(t) or not rel(t).startswith('templates/'):return self.sendj(404,{'error':'Template not found'})
     content=read(t)
    write(p,content);return self.sendj(201,{'path':rel(p)})
   if route=='/api/mkdir':
    p=safe(d.get('path',''));os.makedirs(p,exist_ok=True);return self.sendj(201,{'path':rel(p)})
   return self.sendj(404,{'error':'Unknown endpoint'})
  except Exception as e:return self.sendj(400,{'error':str(e)})
 def do_PUT(self):
  try:
   if urlparse(self.path).path!='/api/file':return self.sendj(404,{'error':'Unknown endpoint'})
   d=self.body();p=safe(d['path'])
   if not textfile(p):return self.sendj(400,{'error':'Unsupported file type'})
   if not os.path.isfile(p):return self.sendj(404,{'error':'File not found'})
   write(p,d.get('content',''));return self.sendj(200,{'path':rel(p),'saved':True})
  except Exception as e:return self.sendj(400,{'error':str(e)})
 def static(self,name):
  p=os.path.abspath(os.path.join(STATIC,name))
  if not p.startswith(STATIC+os.sep) or not os.path.isfile(p):return self.sendj(404,{'error':'Static file not found'})
  typ=mimetypes.guess_type(p)[0] or 'application/octet-stream';b=open(p,'rb').read();self.send_response(200);self.send_header('Content-Type',typ+'; charset=utf-8' if typ.startswith(('text/','application/javascript')) else typ);self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
if __name__=='__main__':
 print('Vault:',ROOT);print(f'Open http://127.0.0.1:{PORT}');ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
