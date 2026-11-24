import re,sys,json,os
S,I,OUT=sys.argv[1],sys.argv[2],sys.argv[3]
emap={}
for line in open(S+'/emojimap.txt',encoding='utf8'):
  line=line.rstrip('\n')
  if not line.strip(): continue
  e,n=line.rsplit(' ',1); emap[e.replace('️','')]=n
alias={'home':'house','calendar':'calendar','check':'check','tasks':'list-checks','cart':'shopping-cart','mic':'mic','plus':'plus','menu':'layout-grid','more':'ellipsis','close':'x','left':'chevron-left','right':'chevron-right','clock':'clock','repeat':'repeat','bell':'bell','users':'users','photo':'image','server':'server','settings':'settings','help':'circle-help','lock':'lock','trash':'trash-2','flag':'flag','pin':'map-pin','keyboard':'keyboard','sync':'refresh-cw','cloudOff':'cloud-off','external':'external-link','sun':'sun','sparkle':'sparkles','list':'list','grid':'layout-grid','download':'download','upload':'upload','power':'power','link':'link','edit':'pencil','wifi':'wifi','undo':'undo-2','meal':'utensils','star':'star'}
extra='''message-square-text contact book-user graduation-cap wallet folder-lock smartphone frame calendar-plus settings-2 circle-help house list-checks layout-grid trash-2 sun sunset sunrise moon cloud cloud-sun cloud-moon cloud-drizzle cloud-rain cloud-snow cloud-lightning cloud-fog cloud-hail wind droplets thermometer umbrella gauge eye leaf flower-2 triangle-alert info circle-check star gift trophy flame repeat-2 recycle package newspaper file-text file-image file shirt glasses scan-line receipt euro piggy-bank car bus heart-pulse stethoscope phone phone-call siren baby school sparkles lightbulb mic keyboard search tag store chef-hat cooking-pot book-open notebook-pen apple croissant milk beef fish snowflake soup candy cup-soda shopping-basket spray-can scroll paw-print circle-dot ellipsis chevron-down arrow-right map-pin calendar-days calendar-clock clock bell-ring user users user-round award crown list-todo party-popper pin badge-percent hand-heart wand-sparkles languages send x eye eye-off arrow-right copy trophy medal crown gem target rocket shield-check lock-keyhole volume-2 volume-x badge-check message-circle circle-plus sparkle hand-metal sun-moon'''.split()
need=set(emap.values())|set(alias.values())|set(extra)
icons={}
for n in sorted(need):
  t=open(f'{I}/{n}.svg',encoding='utf8').read()
  body=re.search(r'<svg[^>]*>(.*)</svg>',t,re.S).group(1)
  body=re.sub(r'\s+',' ',body).replace(' />','/>').strip()
  icons[n]=body
js='''// Symbole: Lucide (https://lucide.dev), ISC-Lizenz – Copyright (c) Lucide Contributors 2022,
// Teile (c) Cole Bemis 2013-2022 (Feather, MIT). Automatisch erzeugt, nur die benötigten Symbole.
// EMOJI: welches Symbol ein Emoji im Eltern-/Erwachsenenprofil ersetzt (Kinderprofil zeigt Emojis).
export const ICONS = %s;
export const ALIAS = %s;
export const EMOJI = %s;
''' % (json.dumps(icons,ensure_ascii=False,separators=(',',':')).replace('","','",\n"'), json.dumps(alias,separators=(',',':')), json.dumps(emap,ensure_ascii=False,separators=(',',':')))
open(OUT,'w',encoding='utf8').write(js)
print(len(icons),'icons',os.path.getsize(OUT),'bytes')
