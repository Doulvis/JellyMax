// Mises à jour depuis le serveur : chaque build (Windows, Android, TV) embarque un petit chargeur dans
// index.html. Au lancement, il lit `<remoteUrl>/<canal>/manifest.json` sur le serveur et, s'il est joignable
// et compatible avec la coquille installée, charge le JavaScript et le CSS de JellyMax depuis le serveur.
// Sinon (serveur éteint, hors de la maison, version plus ancienne…) il charge la copie embarquée.
//
// La page reste locale (file:// ou http://localhost) : sessions enregistrées, pont Electron, plugins
// Capacitor, API Samsung et touches de la télécommande fonctionnent comme avant.
//
//  - `remoteUrl` : adresse du serveur, dans ~/.jellymax/server.json (hors du dépôt, comme la clé de
//    signature Android) ou la variable JELLYMAX_REMOTE_URL. Vide : pas de mises à jour depuis un serveur ;
//  - `jellymax.shell` (package.json) : version de la coquille native. À incrémenter quand le code natif change
//    (electron/, android/, tizen/config.xml, privilèges…) : les appareils devront alors réinstaller l'appli,
//    et le serveur ne leur enverra plus de version qui en a besoin tant que ce n'est pas fait.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Réglages personnels du serveur : { remoteUrl, publish: { host, path, key } }. */
export function serverConfig() {
  const file = process.env.JELLYMAX_SERVER_CONFIG || path.join(os.homedir(), '.jellymax', 'server.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function jellymaxConfig(root = process.cwd()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {
    version: pkg.version,
    shell: Number(pkg.jellymax && pkg.jellymax.shell) || 1,
    remoteUrl: String(process.env.JELLYMAX_REMOTE_URL ?? serverConfig().remoteUrl ?? '').replace(/\/+$/, ''),
  };
}

export const channelFor = (mode) => (mode === 'tizen' ? 'tizen' : mode === 'android' ? 'android' : 'windows');

export function remotePlugin() {
  let outDir = 'dist';
  let channel = 'windows';
  let manifest = null;
  return {
    name: 'jellymax-remote',
    apply: 'build',
    // Après les plugins TV / Android, qui réécrivent aussi les balises <script>.
    enforce: 'post',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      channel = channelFor(config.mode);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const { version, shell, remoteUrl } = jellymaxConfig();
        const js = [];
        const css = [];
        html = html
          .replace(/\s*<script\b[^>]*\bsrc="\.\/([^"]+)"[^>]*><\/script>/g, (_m, src) => {
            js.push(src);
            return '';
          })
          .replace(/\s*<link rel="stylesheet"[^>]*\bhref="\.\/([^"]+)"[^>]*>/g, (_m, href) => {
            css.push(href);
            return '';
          })
          .replace(/\s*<link rel="modulepreload"[^>]*>/g, '');
        manifest = { version, shell, js, css, module: channel !== 'tizen' };
        const boot = { ...manifest, channel, remote: remoteUrl };
        return html.replace(/(\s*)<\/head>/, `$1  <script>${loader(boot)}</script>$1</head>`);
      },
    },
    closeBundle() {
      if (manifest) fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    },
  };
}

/** Chargeur en ES5 (les TV 2020 n'ont que Chromium 69 et pas de module ES en file://). */
function loader(boot) {
  return `(function(){
var B=${JSON.stringify(boot)};
function newer(a,b){a=String(a).split('.');b=String(b).split('.');for(var i=0;i<3;i++){var x=+a[i]||0,y=+b[i]||0;if(x!==y)return x>y;}return false;}
function start(base,m,fallback){
  var head=document.head,added=[];
  window.__JM_SOURCE__={from:base==='./'?'local':'server',version:m.version};
  for(var i=0;i<m.css.length;i++){var l=document.createElement('link');l.rel='stylesheet';l.href=base+m.css[i];head.appendChild(l);added.push(l);}
  for(var j=0;j<m.js.length;j++){var s=document.createElement('script');s.src=base+m.js[j];s.async=false;
    if(m.module){s.type='module';s.crossOrigin='anonymous';}
    if(fallback&&j===0)s.onerror=function(){for(var k=0;k<added.length;k++)head.removeChild(added[k]);fallback();};
    head.appendChild(s);added.push(s);}
}
function local(){start('./',B);}
var remote=B.remote;try{remote=localStorage.getItem('jm.remoteUrl')||remote;}catch(e){}
if(!remote)return local();
var dir=remote.replace(/\\/+$/,'')+'/'+B.channel+'/',done=false;
function once(f){return function(){if(done)return;done=true;f.apply(null,arguments);};}
var fail=once(local);
var ok=once(function(m){
  if(!m||!m.js||!m.js.length||+m.shell>B.shell||newer(B.version,m.version)){local();return;}
  start(dir,m,local);
});
try{
  var x=new XMLHttpRequest();
  x.open('GET',dir+'manifest.json?t='+Date.now(),true);
  x.timeout=4000;
  x.onload=function(){if(x.status!==200)return fail();var m;try{m=JSON.parse(x.responseText);}catch(e){return fail();}ok(m);};
  x.onerror=x.ontimeout=fail;
  x.send();
  setTimeout(fail,5000);
}catch(e){fail();}
})();`;
}
