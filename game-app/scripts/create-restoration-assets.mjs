// Original, code-authored vector study pack. No archival media or traced pixels.
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../public/assets/packs/public/',import.meta.url));
const assets={};
const svg=(body,w=100,h=120)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
function add(id,path,body){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),body);assets[id]={path,type:'image',rights:{license:'ORIGINAL',creator:'SpyConverter Game restoration project',source:'Code-authored vector study; scripts/create-restoration-assets.mjs. Not historical artwork.'}};}
const palette={flame:['#ce5347','#72364c'],ice:['#4b9dd0','#294878'],earth:['#62975a','#42533f']};
function person(robe,hair,style='student',female=false){return svg(`
<ellipse cx="50" cy="112" rx="23" ry="6" fill="#223e48" opacity=".19"/>
<path d="M35 97v13h12l3-17 3 17h13V96" fill="#314454" stroke="#233444" stroke-width="2"/>
<path d="M31 66Q50 55 69 66L77 97Q51 110 24 97Z" fill="${robe}" stroke="#2c3d4c" stroke-width="2.5"/>
<path d="M47 67v32m-19-5 46 0" stroke="#f9d786" stroke-width="4"/>
<path d="m33 70-13 12 5 8 15-10m26-10 12 13-6 7-12-13" fill="${robe}" stroke="#293e4c" stroke-width="2"/>
<ellipse cx="25" cy="88" rx="5" ry="6" fill="#f1caa1"/><ellipse cx="74" cy="88" rx="5" ry="6" fill="#f1caa1"/>
${female?`<path d="M23 38q-9 30 3 44l11-12 26 3 14 10q13-39-5-48" fill="${hair}" stroke="#263444" stroke-width="2"/>`:''}
<ellipse cx="50" cy="45" rx="27" ry="29" fill="#f6d6af" stroke="#403c46" stroke-width="2"/>
<path d="M23 44Q13 14 45 11q40-1 33 38L65 31l-9 8-9-10-10 15-3-11Z" fill="${hair}" stroke="#303644" stroke-width="2"/>
<path d="M33 48h10m14 0h10" stroke="#463e47" stroke-width="2.5" stroke-linecap="round"/>
<ellipse cx="39" cy="53" rx="4" ry="6" fill="#324453"/><ellipse cx="61" cy="53" rx="4" ry="6" fill="#324453"/>
<circle cx="40" cy="51" r="1.6" fill="white"/><circle cx="62" cy="51" r="1.6" fill="white"/>
<ellipse cx="30" cy="61" rx="5" ry="2" fill="#d98483" opacity=".5"/><ellipse cx="70" cy="61" rx="5" ry="2" fill="#d98483" opacity=".5"/>
<path d="M45 65q5 5 10 0" fill="none" stroke="#8b5959" stroke-width="2" stroke-linecap="round"/>
${style==='elder'?'<path d="M27 60q-4 28 22 39l4-11 8 7q16-20 12-35l-13 12-11-4-11 4Z" fill="#f7edd7" stroke="#777a79" stroke-width="1.5"/>':''}
${style==='wizard'||style==='elder'?`<path d="M17 27 40 0 65 5l14 27Q50 42 17 27" fill="${robe}" stroke="#334455" stroke-width="2"/><path d="m39 5 17 22-15-2" fill="none" stroke="#f6d683" stroke-width="3"/><path d="m80 101 5-55" stroke="#8b6842" stroke-width="5"/><circle cx="85" cy="48" r="8" fill="#b4e8ff" stroke="#f2d692" stroke-width="3"/>`:''}
${style==='keeper'?'<path d="M20 23q31-22 58 5l-7 10-46-6Z" fill="#497aa1" stroke="#253c51" stroke-width="2"/><path d="M18 82v28m-7-10h14" stroke="#ab8651" stroke-width="5"/>':''}
`);}
for(const [element,[robe,hair]] of Object.entries(palette))for(const sex of ['male','female'])add(`character.${element}.${sex}`,`characters/${element}-${sex}.svg`,person(robe,hair,'student',sex==='female'));
const people={george:['#5079a2','#928979','keeper'],skoll:['#398aca','#89c7e5','wizard'],morris:['#794254','#e7e3d0','elder'],julia:['#955276','#644538','wizard',true],mina:['#779655','#974831','student',true],shou:['#498789','#34537a','student'],samuel:['#957345','#675648','student'],kesno:['#d06443','#984831','student'],isaac:['#6e8c47','#604339','student'],aaron:['#b8423e','#55474c','wizard'],odangka:['#6f8757','#ded6bd','elder'],matilda:['#dc8ca8','#e0ba63','student',true],esta:['#c65c39','#954647','wizard',true],ishubike:['#688458','#515a46','wizard'],rie:['#a78bb9','#414361','wizard',true],pelita:['#ae725c','#d0a463','wizard',true],barbara:['#72608d','#cec3c2','elder'],hubert:['#7aa4b1','#695c51','student']};
Object.assign(people,{conrad:['#926b90','#5b3f4e','student',true],'caesar-iii':['#af8650','#bba783','elder'],edward:['#788f9e','#5b5146','student'],hina:['#ca858f','#675b3f','student',true],amela:['#c0c9be','#685040','student',true],douglas:['#958061','#625344','keeper'],murphy:['#716853','#b39a70','keeper'],chili:['#998f6d','#5a463e','wizard'],baldi:['#967b57','#78563d','elder'],kobold:['#a19b73','#84744e','elder'],naomi:['#688daa','#857889','wizard',true],leona:['#9aaf70','#d1b77c','wizard',true],'muhammad-ali-iv':['#a78758','#634632','elder'],kadija:['#8c7ba4','#413443','student',true]});
for(const [name,args] of Object.entries(people)){add(`npc.${name}.overworld`,`npcs/${name}.svg`,person(...args));add(`npc.${name}.portrait`,`portraits/${name}.svg`,person(...args));}
const scorpion=svg('<ellipse cx="50" cy="107" rx="37" ry="7" fill="#30404a" opacity=".2"/><path d="M59 74q51-24 17-57l-15 1 12 15q13 18-20 29" fill="#b89453" stroke="#584736" stroke-width="5"/><path d="m31 83-22 9m24 1-19 13m47-23 25 9m-24 1 16 13" stroke="#85683f" stroke-width="6"/><ellipse cx="48" cy="82" rx="27" ry="20" fill="#c3a064" stroke="#584736" stroke-width="3"/><path d="M25 76 7 55 5 38l15 12 8 21m40 5 20-23 6-16-17 11-12 21" fill="#c3a064" stroke="#584736" stroke-width="5"/><circle cx="38" cy="74" r="4" fill="#423e35"/><circle cx="56" cy="74" r="4" fill="#423e35"/>');
add('npc.scorpion.overworld','npcs/scorpion.svg',scorpion);add('npc.scorpion.portrait','portraits/scorpion.svg',scorpion);
const spirit=(color,evolved=false)=>svg(`<ellipse cx="50" cy="103" rx="25" ry="6" fill="#284b54" opacity=".2"/><path d="M18 85Q7 58 37 32L45 ${evolved?'0':'12'}Q73 34 65 49l18-12q23 57-23 66Q27 111 18 85Z" fill="${color}" stroke="#31536a" stroke-width="3"/><ellipse cx="48" cy="73" rx="23" ry="23" fill="#f1f7e2" opacity=".48"/><ellipse cx="39" cy="68" rx="4" ry="7" fill="#30415a"/><ellipse cx="59" cy="68" rx="4" ry="7" fill="#30415a"/><path d="M43 85q7 7 13-1" fill="none" stroke="#30415a" stroke-width="3"/>`);
for(const [element,[color]] of Object.entries(palette)){add(`pet.${element}-spirit.overworld`,`pets/${element}-spirit.svg`,spirit(color));add(`pet.${element}-spirit.evolved`,`pets/${element}-spirit-evolved.svg`,spirit(color,true));}
const eagle=svg('<ellipse cx="50" cy="111" rx="26" ry="5" fill="#304954" opacity=".2"/><path d="M36 83 3 55q-8 49 34 44m26-16 34-29q8 49-36 45" fill="#a77649" stroke="#4e4d48" stroke-width="3"/><ellipse cx="50" cy="85" rx="25" ry="26" fill="#ba9565" stroke="#524938" stroke-width="2"/><ellipse cx="50" cy="48" rx="28" ry="28" fill="#f7e8bd" stroke="#524938" stroke-width="2"/><path d="m41 62 9 12 11-14Z" fill="#dc9c41"/><circle cx="38" cy="47" r="5" fill="#344552"/><circle cx="62" cy="47" r="5" fill="#344552"/><path d="m38 15 8 9 11-12 6 15" fill="#c5a773"/><path d="m35 107-7 8m30-8 11 8" stroke="#c48d43" stroke-width="5"/>');
add('pet.baby-eagle.overworld','pets/baby-eagle.svg',eagle);add('pet.baby-eagle.evolved','pets/eagle.svg',eagle);add('npc.shiva.overworld','npcs/shiva.svg',eagle);add('npc.shiva.portrait','portraits/shiva.svg',eagle);
for(const [name,color,glyph] of [['fire','#e56e42','✦'],['ice','#75c6e6','❄'],['earth','#91b76c','◆'],['healing','#91c997','✚'],['item','#ba935f','◆'],['object','#b09067','✦'],['encounter','#b390d1','◆']])add(`icon.${name}`,`ui/${name}.svg`,svg(`<circle cx="50" cy="55" r="39" fill="${color}" stroke="#fbe8b9" stroke-width="6"/><circle cx="50" cy="55" r="32" fill="none" stroke="#455e75" stroke-width="2"/><text x="50" y="73" text-anchor="middle" font-family="serif" font-size="49" fill="#fff8db">${glyph}</text>`));
for(const theme of ['grounds','hall','classroom','office','village','shop','forest','basement','arena','maze','library','dorm']){
  const interior=['hall','classroom','office','shop','basement','maze','library','dorm'].includes(theme);
  add(`map.${theme}.background`,`maps/${theme}.svg`,svg(`<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${interior?'#838894':'#91c4d7'}"/><stop offset="1" stop-color="${interior?'#d9cbb4':'#e7ead0'}"/></linearGradient></defs><rect width="960" height="540" fill="url(#sky)"/>${interior?'<path d="M0 0h960v115L480 365 0 115" fill="#515e73" opacity=".3"/>':'<path d="M0 125 105 72 230 110 359 55 521 105 643 49 790 108 960 55v280H0Z" fill="#6b9b87" opacity=".36"/><path d="M0 196 180 135 337 175 551 115 760 176 960 127v290H0Z" fill="#629674" opacity=".4"/>'}<ellipse cx="495" cy="459" rx="394" ry="51" fill="#294a4a" opacity=".2"/>`,960,540));
}
writeFileSync(join(root,'manifest.json'),JSON.stringify({id:'public',version:2,assets},null,2)+'\n');
console.log(`Created ${Object.keys(assets).length} original vector study assets.`);
