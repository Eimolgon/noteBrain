#!/usr/bin/env python3
"""Portable local Markdown vault UI. Run from your vault root: python app/server.py"""
import json, os, re, time, mimetypes, tempfile, shutil, subprocess, base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
ROOT=os.path.realpath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATIC=os.path.join(os.path.dirname(os.path.abspath(__file__)),"static")
PORT=int(os.environ.get("NOTES_PORT","8765"))
MD={".md",".markdown"}; TEXT=MD|{".txt",".bib",".tex",".json",".yaml",".yml",".py",".js",".html",".css",".sh"}
BIB=re.compile(r"@(\w+)\s*\{\s*([^,\s]+)\s*,",re.M)
WIKI=re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")
BACKLINK_START='<!-- AUTO-BACKLINKS:START -->'
BACKLINK_END='<!-- AUTO-BACKLINKS:END -->'
BACKLINK_BLOCK=re.compile(r'(?ms)^<!-- AUTO-BACKLINKS:START -->\s*.*?^<!-- AUTO-BACKLINKS:END -->[ \t]*(?:\n|$)')
FIELDS=re.compile(r"^\s*(id|title|date|deadline|keywords|tags|author|authors|participant|participants|attendee|attendees|category|topic|status|priority)\s*:\s*(.*?)\s*$",re.I|re.M)
def safe(relpath, *, allow_root=False):
 # Reject absolute paths and traversal before resolving, then verify the resolved
 # destination remains inside the vault. Reject symlinks in existing path components
 # so operations never unexpectedly follow a link to another location.
 if not isinstance(relpath, str) or not relpath.strip():
  if allow_root: return ROOT
  raise ValueError('A relative path is required')
 raw=unquote(relpath).replace('\\','/')
 if raw.startswith('/') or re.match(r'^[A-Za-z]:', raw): raise ValueError('Absolute paths are not allowed')
 parts=raw.split('/')
 if any(part in ('.','..') for part in parts): raise ValueError('Path traversal is not allowed')
 p=os.path.abspath(os.path.join(ROOT, *parts))
 resolved=os.path.realpath(p)
 if os.path.commonpath((ROOT,resolved)) != ROOT: raise ValueError('Path escapes vault root')
 current=ROOT
 for part in parts:
  if not part: continue
  current=os.path.join(current,part)
  if os.path.islink(current): raise ValueError('Symbolic links are not supported for file operations')
 if p==ROOT and not allow_root: raise ValueError('The vault root is not a file path')
 return p
def rel(p): return os.path.relpath(p,ROOT).replace(os.sep,'/')
def textfile(p): return os.path.splitext(p)[1].lower() in TEXT
def read(p):
 with open(p,encoding='utf-8',errors='replace') as f:return f.read()
def write(p,s):
 # Atomic replacement in the destination directory; unique temporary files avoid
 # collisions between concurrent saves.
 directory=os.path.dirname(p)
 fd,tmp=tempfile.mkstemp(prefix='.notes-tmp-',dir=directory,text=True)
 try:
  with os.fdopen(fd,'w',encoding='utf-8',newline='') as f: f.write(s)
  os.replace(tmp,p)
 except Exception:
  try: os.unlink(tmp)
  except OSError: pass
  raise
def populate_template(content, template_path):
 from datetime import date
 today=date.today().isoformat()
 # Fill only empty Date metadata fields; never replace an existing value.
 content=re.sub(r'(?im)^(\s*Date\s*:\s*)$', lambda m: m.group(1)+today, content)
 # The daily template explicitly uses this placeholder as its heading.
 if template_path.replace('\\','/').lower() == 'templates/daily.md':
  content=re.sub(r'(?m)^yymmdd\s*$', date.today().strftime('%y%m%d'), content, count=1)
 return content
def metadata(s):
 # Read existing metadata conventions, including fields inside fenced blocks.
 m={k.lower():v.strip().strip('"\'') for k,v in FIELDS.findall(s)}
 tm=re.search(r'^Tags\s*\n=+\s*(.*?)(?=^\S|\Z)',s,re.M|re.S)
 tags=[]
 if tm:
  for line in tm.group(1).splitlines():
   if ':' in line: tags += [x.strip().strip('"\'') for x in re.split('[,;]',line.split(':',1)[1]) if x.strip()]
 if m.get('tags'): tags += [x.strip() for x in re.split('[,;]',m['tags']) if x.strip()]
 m['tags']=sorted(set(tags),key=str.lower)
 m['authors']=m.get('authors') or m.get('author','')
 if not m['authors']:
  bib_authors=re.findall(r'(?im)^\s*author\s*=\s*[\{\"](.*?)[\}\"]\s*,?\s*$',s)
  if bib_authors: m['authors']='; '.join(re.sub(r'\s+',' ',v).strip() for v in bib_authors)
 m['participants']=m.get('participants') or m.get('participant') or m.get('attendees') or m.get('attendee','')
 h=re.search(r'^#\s+(.+?)\s*$|^([^\n=]+)\n=+\s*$',s,re.M)
 if h:m.setdefault('title',(h.group(1) or h.group(2)).strip())
 return m
def without_generated_backlinks(content):
 # Generated backlink links must never count as outgoing Zettelkasten links.
 return BACKLINK_BLOCK.sub('', content)
def generated_backlink_block(target_path, backlink_paths):
 if not backlink_paths: return ''
 lines=[BACKLINK_START, '## Backlinks', '']
 target_dir=os.path.dirname(target_path) or '.'
 for source_path in sorted(set(backlink_paths),key=str.casefold):
  relative=os.path.relpath(source_path,target_dir).replace(os.sep,'/')
  label=source_path.replace('|','\\|').replace(']', '\\]')
  lines.append(f'- [[{relative}|{label}]]')
 lines.extend(['', BACKLINK_END])
 return '\n'.join(lines)
def update_backlink_sections():
 """Maintain generated backlink sections without changing user-authored note text."""
 data=index_data()
 backlinks={note['path']:note['backlinks'] for note in data['notes']}
 changed=0
 for note in data['notes']:
  path=note['path']
  if os.path.splitext(path)[1].lower() not in MD: continue
  full=safe(path)
  try: content=read(full)
  except OSError: continue
  had_block=bool(BACKLINK_BLOCK.search(content))
  block=generated_backlink_block(path,backlinks.get(path,[]))
  if not had_block and not block: continue
  clean=BACKLINK_BLOCK.sub('',content).rstrip('\n')
  if block:
   updated=(clean+'\n\n' if clean else '')+block+'\n'
  else:
   updated=clean+'\n' if clean else ''
  if updated != content:
   write(full,updated); changed+=1
 return {'updated':changed}

def all_notes():
 out=[]
 for cur,dirs,names in os.walk(ROOT):
  dirs[:]=sorted(d for d in dirs if not d.startswith('.') and d not in {'app','__pycache__'} and not os.path.islink(os.path.join(cur,d)))
  for n in sorted(names):
   p=os.path.join(cur,n)
   if not os.path.islink(p) and textfile(p):
    try:
     s=read(p); m=metadata(s); st=os.stat(p)
     out.append({'path':rel(p),'name':n,'directory':os.path.dirname(rel(p)),'title':m.get('title') or os.path.splitext(n)[0],'id':m.get('id',''),'date':m.get('date',''),'category':m.get('category',''),'topic':m.get('topic',''),'status':m.get('status',''),'priority':m.get('priority',''),'authors':m.get('authors',''),'participants':m.get('participants',''),'keywords':m.get('keywords',''),'tags':m['tags'],'references':[{'type':a.lower(),'key':b} for a,b in BIB.findall(s)],'links':WIKI.findall(without_generated_backlinks(s)),'modified':st.st_mtime,'size':st.st_size})
    except OSError:pass
 return out
def index_data():
 notes=all_notes(); by={n['path']:n for n in notes}; by_case={p.casefold():p for p in by}; lookup={}
 for n in notes:
  stem=os.path.splitext(n['name'])[0]
  path_stem=os.path.splitext(n['path'])[0]
  for key in (n['path'],path_stem,n['name'],stem,n['title'],n['id']):
   if key: lookup.setdefault(key.strip().casefold(),n['path'])
 for n in notes: n['resolved_links']=[]; n['backlinks']=[]
 for n in notes:
  for link in n['links']:
   raw=link.strip().replace('\\','/').lstrip('/')
   target=None
   # Path-like wiki links resolve relative to the source note first, then from
   # the vault root. Extensionless paths are accepted as Markdown note paths.
   if '/' in raw or re.search(r'\.(md|markdown)$',raw,re.I):
    candidates=[os.path.normpath(os.path.join(os.path.dirname(n['path']),raw)).replace(os.sep,'/'),os.path.normpath(raw).replace(os.sep,'/')]
    if not re.search(r'\.(md|markdown)$',raw,re.I):
     candidates += [c+'.md' for c in list(candidates)]
    for candidate in candidates:
     target=by_case.get(candidate.casefold())
     if target: break
   if not target:
    target=lookup.get(raw.casefold())
   if target and target in by and target not in n['resolved_links']:
    n['resolved_links'].append(target)
    if n['path'] not in by[target]['backlinks']: by[target]['backlinks'].append(n['path'])
 sets={k:{} for k in ('tags','statuses','categories','topics','authors','participants','keywords')}
 for n in notes:
  for tag in n['tags']: sets['tags'].setdefault(tag,[]).append(n['path'])
  for field,bucket in [('status','statuses'),('category','categories'),('topic','topics'),('authors','authors'),('participants','participants'),('keywords','keywords')]:
   splitter=r'\s+and\s+|;' if field=='authors' else '[,;]'
   for value in [v.strip() for v in re.split(splitter,n.get(field,'') or '',flags=re.I) if v.strip()]: sets[bucket].setdefault(value,[]).append(n['path'])
 return {'generated':time.time(),'notes':notes,**{k:dict(sorted(v.items(),key=lambda x:x[0].lower())) for k,v in sets.items()}}

def generate_info_index():
 """Regenerate info/index.md in the existing alphabetical-list format."""
 info=safe('info')
 if not os.path.isdir(info): raise ValueError('The info/ directory does not exist')
 entries=[]
 for cur,dirs,names in os.walk(info):
  dirs[:]=sorted(d for d in dirs if not d.startswith('.') and not os.path.islink(os.path.join(cur,d)))
  for name in sorted(names,key=str.lower):
   path=os.path.join(cur,name); rp=rel(path)
   if os.path.islink(path) or os.path.splitext(name)[1].lower() not in MD or rp.lower() in {'info/index.md','info/readme.md'}: continue
   content=read(path); meta=metadata(content); title=(meta.get('title') or os.path.splitext(name)[0]).strip()
   target=os.path.relpath(path,info).replace(os.sep,'/')
   entries.append((title,target))
 groups={}
 for title,target in entries:
  first=title[:1].upper(); group=first if 'A' <= first <= 'Z' else '#'
  groups.setdefault(group,[]).append((title,target))
 lines=['id: Index','=========','']
 for group in list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')+['#']:
  lines.extend([group,'-',''])
  for title,target in sorted(groups.get(group,[]),key=lambda x:(x[0].casefold(),x[1].casefold())):
   label=title.replace('[','\\[').replace(']','\\]')
   lines.append(f'- [{label}]({target})')
  lines.append('')
 write(os.path.join(info,'index.md'),'\n'.join(lines).rstrip()+'\n')
 return {'path':'info/index.md','count':len(entries)}

def bib_entries(content):
 """Extract complete BibTeX entries by balanced braces, including multiline fields."""
 out=[]
 for match in re.finditer(r'@([A-Za-z]+)\s*([({])\s*([^,\s]+)\s*,',content):
  start=match.start(); opener=match.group(2); closer='}' if opener=='{' else ')'; depth=0; quote=False; escaped=False; end=None
  for i in range(content.find(opener,match.start()),len(content)):
   ch=content[i]
   if escaped: escaped=False; continue
   if ch=='\\': escaped=True; continue
   if ch=='"': quote=not quote; continue
   if quote: continue
   if ch==opener: depth+=1
   elif ch==closer:
    depth-=1
    if depth==0: end=i+1; break
  if end: out.append({'type':match.group(1).lower(),'key':match.group(3).strip(),'text':content[start:end].strip()})
 return out

def collect_bibtex():
 """Write a deterministic, deduplicated bibliography from Markdown notes in info/."""
 info=safe('info')
 if not os.path.isdir(info): raise ValueError('The info/ directory does not exist')
 found=[]
 for cur,dirs,names in os.walk(info):
  dirs[:]=sorted(d for d in dirs if not d.startswith('.') and not os.path.islink(os.path.join(cur,d)))
  for name in sorted(names,key=str.lower):
   path=os.path.join(cur,name)
   if os.path.islink(path) or os.path.splitext(name)[1].lower() not in MD or rel(path).lower() in {'info/index.md','info/readme.md'}: continue
   for entry in bib_entries(read(path)): found.append((rel(path),entry))
 found.sort(key=lambda x:(x[0].casefold(),x[1]['key'].casefold()))
 unique={}; conflicts=[]
 for source,entry in found:
  key=entry['key'].casefold()
  if key not in unique: unique[key]=(source,entry)
  elif re.sub(r'\s+',' ',unique[key][1]['text']) != re.sub(r'\s+',' ',entry['text']): conflicts.append({'key':entry['key'],'kept_from':unique[key][0],'duplicate_from':source})
 content='\n\n'.join(v[1]['text'] for v in unique.values())
 marker='% Generated automatically by Vault Workbench; do not edit this file directly.'
 content=marker+'\n\n'+content.rstrip()+'\n'
 destination=safe('info/references.bib')
 # Never overwrite a manually maintained bibliography: only replace a file that
 # carries our generator marker from a previous run.
 if os.path.exists(destination) and marker not in read(destination):
  raise ValueError('info/references.bib already exists and is not marked as generated; move it or choose another output path before collecting references')
 write(destination,content)
 return {'path':'info/references.bib','count':len(unique),'found':len(found),'duplicates':len(found)-len(unique),'conflicts':conflicts}
def tree():
 def walk(p):
  node={'name':os.path.basename(p) or '.','path':rel(p),'type':'directory','children':[]}
  try: entries=sorted(os.scandir(p),key=lambda e:(not e.is_dir(),e.name.lower()))
  except OSError:return node
  for e in entries:
   if e.name.startswith('.') or e.name in {'app','__pycache__'} or e.is_symlink():continue
   if e.is_dir(follow_symlinks=False):node['children'].append(walk(e.path))
   elif e.is_file(follow_symlinks=False) and textfile(e.path):node['children'].append({'name':e.name,'path':rel(e.path),'type':'file'})
  return node
 return walk(ROOT)
class Handler(BaseHTTPRequestHandler):
 server_version='VaultWorkbench/2.1'
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
    qtext=q.get('q',[''])[0].lower().strip(); tag=q.get('tag',[''])[0].lower(); status=q.get('status',[''])[0].lower();cat=q.get('category',[''])[0].lower();topic=q.get('topic',[''])[0].lower();author=q.get('author',[''])[0].lower();participant=q.get('participant',[''])[0].lower();res=[]
    for n in all_notes():
     if tag and tag not in [x.lower() for x in n['tags']]:continue
     if status and n['status'].lower()!=status:continue
     if cat and n['category'].lower()!=cat:continue
     if topic and topic not in [x.strip().lower() for x in re.split('[,;]',n['topic'])]:continue
     if author and author not in [x.strip().lower() for x in re.split(r'\s+and\s+|;',n['authors'],flags=re.I)]:continue
     if participant and participant not in [x.strip().lower() for x in re.split('[,;]',n['participants'])]:continue
     if qtext and qtext not in ' '.join([n['path'],n['title'],n['id'],n['date'],n['category'],n['topic'],n['status'],n['priority'],n['authors'],n['participants'],n['keywords'],' '.join(n['tags']),read(safe(n['path']))]).lower():continue
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
    if os.path.isdir(p):vals=[{'name':n,'path':'templates/'+n} for n in sorted(os.listdir(p)) if not os.path.islink(os.path.join(p,n)) and os.path.isfile(os.path.join(p,n)) and textfile(n)]
    return self.sendj(200,vals)
   return self.sendj(404,{'error':'Unknown endpoint'})
  except Exception as e:return self.sendj(400,{'error':str(e)})
 def do_POST(self):
  try:
   d=self.body();route=urlparse(self.path).path
   if route=='/api/export-pdf':
    # Export the current editor contents without requiring a save first.
    if shutil.which('pandoc') is None:
     return self.sendj(503,{'error':'Pandoc is not installed or is not available on PATH. Install Pandoc, restart the application, and try again.'})
    content=d.get('content','')
    filename=os.path.basename(str(d.get('filename') or 'note.md'))
    if not filename.lower().endswith(('.md','.markdown')): filename='note.md'
    with tempfile.TemporaryDirectory(prefix='vault-pdf-') as tmp:
     source=os.path.join(tmp,filename)
     output=os.path.join(tmp,os.path.splitext(filename)[0]+'.pdf')
     with open(source,'w',encoding='utf-8',newline='') as f: f.write(content)
     try:
      result=subprocess.run(['pandoc',source,'--from=markdown','--to=pdf','--output',output],capture_output=True,text=True,timeout=120,check=False)
     except subprocess.TimeoutExpired:
      return self.sendj(504,{'error':'PDF export timed out after 120 seconds.'})
     if result.returncode != 0:
      detail=(result.stderr or result.stdout or 'Pandoc could not create the PDF.').strip()
      return self.sendj(422,{'error':'PDF export failed. Check that a PDF engine such as LaTeX is installed. '+detail[-1800:]})
     with open(output,'rb') as f: encoded=base64.b64encode(f.read()).decode('ascii')
    return self.sendj(200,{'filename':os.path.splitext(filename)[0]+'.pdf','pdf_base64':encoded})
   if route=='/api/reindex':
    index_result=generate_info_index()
    backlinks=update_backlink_sections()
    return self.sendj(200,{**index_result,**backlinks,'reindexed':True})
   if route=='/api/collect-bibtex': return self.sendj(200,collect_bibtex())
   if route=='/api/create':
    name=d.get('path','').strip()
    if not os.path.splitext(name)[1]:name+='.md'
    p=safe(name)
    if os.path.exists(p):return self.sendj(409,{'error':'File already exists'})
    if not os.path.isdir(os.path.dirname(p)): return self.sendj(400,{'error':'Destination folder does not exist'})
    tpl=d.get('template','');content=''
    if tpl:
     t=safe(tpl)
     if not os.path.isfile(t) or not rel(t).startswith('templates/'):return self.sendj(404,{'error':'Template not found'})
     content=populate_template(read(t), rel(t))
    # Exclusive creation avoids replacing a file created between the existence check and write.
    with open(p,'x',encoding='utf-8',newline='') as f: f.write(content)
    return self.sendj(201,{'path':rel(p)})
   if route=='/api/mkdir':
    p=safe(d.get('path',''))
    if os.path.exists(p): return self.sendj(409,{'error':'A file or folder already exists at that path'})
    parent=os.path.dirname(p)
    if not os.path.isdir(parent): return self.sendj(400,{'error':'Parent folder does not exist'})
    os.mkdir(p)
    return self.sendj(201,{'path':rel(p)})
   if route=='/api/delete':
    path=d.get('path',''); p=safe(path)
    if not textfile(p) or os.path.splitext(p)[1].lower() not in MD:
     return self.sendj(400,{'error':'Only Markdown notes can be deleted'})
    if not os.path.isfile(p): return self.sendj(404,{'error':'Markdown note not found'})
    os.unlink(p)
    return self.sendj(200,{'path':rel(p),'deleted':True})
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
  typ=mimetypes.guess_type(p)[0] or 'application/octet-stream'
  with open(p,'rb') as f: b=f.read()
  self.send_response(200);self.send_header('Content-Type',typ+'; charset=utf-8' if typ.startswith(('text/','application/javascript')) else typ);self.send_header('Content-Length',str(len(b)))
  # The UI is designed to work offline and must not silently fetch remote assets.
  # Inline styles/scripts are required by the existing UI and MathJax configuration.
  self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'")
  self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(b)
if __name__=='__main__':
 print('Vault:',ROOT);print(f'Open http://127.0.0.1:{PORT}');ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
