// Authored executable reconstruction. This does not convert the research catalog into quests.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const ev=(source,section,proves,provenance='RECONSTRUCTED')=>({provenance,confidence:provenance==='RESTORATION'?'LOW':'MEDIUM',sourceNotes:[{sourceId:source,section,proves}]});
const authored=ev('brief','Public reconstruction and balancing rules','Original English retelling, vector art, interaction placement and conservative playable estimates; not original game data.','RESTORATION');
const narrative=(episode)=>ev(`wonavy-${187+episode}`,`Episode ${episode} narrative`,'Supports the order of the narrated events; precise triggers, English wording and numeric rewards are restoration.');
const c={version:1,title:'The first days at Arpia',startMapId:'map.school-grounds',origins:[],quests:[],maps:[],actors:[],dialogue:[],spells:[],items:[],pets:[],battles:[],services:[]};
const stats=(hp=80,mp=30,attack=12,defense=7,magicAttack=12,magicDefense=7,agility=8)=>({hp,mp,attack,defense,magicAttack,magicDefense,agility});
const dialogue=(id,speaker,text,source=authored)=>{c.dialogue.push({id,lines:text.map(text=>({speakerId:speaker,text})),...source});return id;};
const actor=(key,name,element='NONE',power=stats(),skills=[])=>{const id='npc.'+key;c.actors.push({id,name,koOriginal:null,spriteAssetId:id+'.overworld',portraitAssetId:id+'.portrait',element,defaultDialogueId:dialogue(id+'.idle',id,[name==='George'?'Mind the freshly swept path!':'There is always something happening at Arpia.']),stats:power,skillIds:skills,...authored,balanceEvidence:authored});};
for(const [id,name,element] of [['george','George'],['skoll','Skoll','ICE'],['morris','Principal Morris'],['julia','Julia'],['mina','Mina'],['shou','Shou'],['samuel','Samuel'],['kesno','Kesno','FLAME'],['isaac','Isaac','EARTH'],['aaron','Aaron','FLAME'],['odangka','Odangka','EARTH'],['shiva','Shiva'],['esta','Esta','FLAME'],['ishubike','Ishubike','EARTH'],['rie','Rie'],['pelita','Pelita'],['barbara','Barbara'],['hubert','Hubert'],['chief','Village Chief'],['family','Family']])actor(id,name,element??'NONE',id==='odangka'?stats(220,60,19,10,20,10,6):id==='aaron'?stats(125,70,16,11,22,12,9):id==='kesno'?stats(105,20,12,5,11,5,6):stats(),id==='aaron'?['spell.fire']:id==='odangka'?['spell.stone-crash']:[]);
for(const [id,name,element,target,kind,power,mp,status] of [
 ['fire','Fire','FLAME','ENEMY','DAMAGE',12,5],['ice','Ice','ICE','ENEMY','DAMAGE',12,5],['stone-crash','Stone Crash','EARTH','ENEMY','DAMAGE',12,5],
 ['healing','Healing','NONE','ALLY','HEAL',18,7],['restore','Restore','NONE','ALLY','REVIVE',22,12],['detox','Detox','NONE','ALLY','CURE',0,4],
 ['fire-arrow','Fire Arrow','FLAME','ENEMY','DAMAGE',22,9,'BURN'],['ice-spear','Ice Spear','ICE','ENEMY','DAMAGE',22,9,'SLOW'],['stone-hand','Stone Hand','EARTH','ENEMY','DAMAGE',22,9,'ATTACK_DOWN'],
 ['blind','Blind','NONE','ENEMY','STATUS',0,8,'BLIND'],['silence','Silence','NONE','ENEMY','STATUS',0,8,'SILENCE'],['poison','Poison','EARTH','ENEMY','STATUS',0,6,'POISON']])c.spells.push({id:'spell.'+id,name,element,mpCost:mp,power,target,kind,...(status?{status,duration:30}:{}),minimumRank:'APPRENTICE',assetId:'icon.'+(element==='FLAME'?'fire':element==='ICE'?'ice':element==='EARTH'?'earth':'healing'),...authored,balanceEvidence:authored});
const item=(id,name,kind,power,price,description,extra={})=>c.items.push({id:'item.'+id,name,description,kind,power,price,sellPrice:kind==='QUEST'?0:Math.floor(price/3),minimumRank:'APPRENTICE',assetId:'icon.item',...extra,...authored,balanceEvidence:authored});
item('small-tonic','Small HP tonic','HP',45,12,'Restores 45 HP. Restoration name and value.');item('mana-tonic','Small MP tonic','MP',25,15,'Restores 25 MP. Restoration name and value.');item('antidote','Antidote','CURE',0,10,'Removes status effects.');item('revive-tonic','Revival tonic','REVIVE',30,30,'Revives a fallen ally with 30 HP.');
item('wand','School wand','EQUIPMENT',0,40,'Samuel supplies a wand before the Kesno duel.',{slot:'WAND',bonus:{magicAttack:3}});item('medicine','Morris’s medicine','QUEST',0,0,'Bring this to Odangka with Aaron.');item('bread','Cafeteria bread','QUEST',0,0,'Isaac has found a use for yesterday’s bread.');
for(const [element,name,spell,pet,power] of [['FLAME','Flame Village','fire','flame-spirit',stats(105,28,16,10,10,6)],['ICE','Ice Village','ice','ice-spirit',stats(80,48,10,6,17,11)],['EARTH','Earth Village','stone-crash','earth-spirit',stats(94,38,13,8,13,8)]]){
 const key=element.toLowerCase();c.origins.push({element,name,mapId:'map.'+key+'-village',startingSpellId:'spell.'+spell,petId:'pet.'+pet,maleAssetId:`character.${key}.male`,femaleAssetId:`character.${key}.female`,stats:power,...authored,balanceEvidence:authored});
 c.pets.push({id:'pet.'+pet,name:element[0]+element.slice(1).toLowerCase()+' Spirit',element,maxLevel:10,evolutionLevel:5,spriteAssetId:'pet.'+pet+'.overworld',evolvedAssetId:'pet.'+pet+'.evolved',skillIds:['spell.'+spell],stats:stats(55,22,8,4,9,5,6),...ev('wonavy-184','Level 10 pets','Starter elemental spirit associated with Episode 1; exact acquisition trigger and statistics are unknown.'),balanceEvidence:authored});
}
c.pets.push({id:'pet.baby-eagle',name:'Baby Eagle',element:'NONE',maxLevel:10,evolutionLevel:5,spriteAssetId:'pet.baby-eagle.overworld',evolvedAssetId:'pet.baby-eagle.evolved',skillIds:[],stats:stats(62,0,11,5,5,5,9),...ev('wonavy-184','Level 10 pets','Baby Eagle is associated with Episode 2; exact reward timing remains unknown.'),balanceEvidence:authored});
const pos=(x,y)=>({x,y});
const flag=(id,value=true)=>({type:'flag',id,value});
const tx=(flags={},items={},pin=0,virtuePoints=0)=>({type:'transaction',flags,items,pin,virtuePoints});
const map=(id,name,theme,npcs=[],objects=[])=>{
 const m={id:'map.'+id,name,...authored,geometryEvidence:authored,width:18,height:14,spawn:pos(8,11),blocked:[],backgroundAssetId:'map.'+theme.toLowerCase()+'.background',theme,npcs:npcs.map(([actor,x,y])=>({actorId:'npc.'+actor,position:pos(x,y),conditions:[]})),objects:objects.map(([key,name,x,y])=>({id:key,name,assetId:'icon.object',position:pos(x,y),conditions:[]})),portals:[],encounters:[]};
 for(let x=0;x<m.width;x++)for(let y=0;y<m.height;y++)if(x===0||y===0||x===m.width-1||y===m.height-1)m.blocked.push(pos(x,y));
 c.maps.push(m);return m;
};
map('school-grounds','Arpia · School grounds','GROUNDS',[['george',6,10],['skoll',9,7],['mina',12,8]]);
map('school-hall','School · First floor','HALL',[['skoll',8,6],['isaac',11,8]]);
map('school-second-floor','School · Second floor','HALL');
map('school-third-floor','School · Third floor','HALL',[['skoll',8,7]],[['object.sealed-room','Sealed room',7,4]]);
map('principal-office','School · Principal’s office','OFFICE',[['morris',8,5]]);
map('homeroom','Our classroom','CLASSROOM',[['julia',8,5]]);
map('shopping-district','School shopping district','GROUNDS',[['barbara',6,5]]);
map('magic-item-shop','Samuel’s magic tool shop','SHOP',[['samuel',8,5]]);
for(const o of c.origins)map(o.mapId.slice(4),o.name,'VILLAGE',[['chief',6,5],['family',11,7],['shou',9,10]]);
map('school-colosseum','School Colosseum','ARENA',[['kesno',6,8],['pelita',11,5]]);
map('cafeteria','School cafeteria','HALL',[],[['object.bread','Yesterday’s bread',7,5]]);
map('school-basement','School basement','BASEMENT',[],[['object.jar','Heavy storage jar',8,5]]);
map('basement-shortcut','The hidden shortcut','BASEMENT',[],[['object.breadcrumbs','Isaac’s breadcrumbs',8,7]]);
map('oak-forest','Oak Forest','FOREST',[['shiva',10,7]],[['object.eagle-trap','A trapped Baby Eagle',7,8]]);
map('odangka-cabin','Odangka’s cabin','FOREST',[['odangka',7,5]]);
map('flame-classroom','Flame magic classroom','CLASSROOM',[['esta',6,5],['aaron',10,5]]);
map('ice-classroom','Ice magic classroom','CLASSROOM',[['skoll',8,5]]);
map('earth-classroom','Earth magic classroom','CLASSROOM',[['ishubike',8,5]]);
map('non-elemental-classroom','Rie’s magic classroom','CLASSROOM',[['rie',8,5]]);
map('pet-center','Pet center','SHOP',[['pelita',8,5]]);
map('health-center','Health center','HALL',[['hubert',8,5]]);
map('dormitory','My dormitory','DORM',[],[['object.bed','Your bed',6,5]]);
const getMap=id=>c.maps.find(m=>m.id==='map.'+id);
let portalIndex=0;
const portal=(from,to,x,y,conditions=[],name)=>{const dest=getMap(to);getMap(from).portals.push({id:'portal.'+(++portalIndex),name:name??dest.name,position:pos(x,y),toMapId:dest.id,spawn:pos(8,11),conditions});};
const link=(a,b,x=12,y=4,conditions=[])=>{portal(a,b,x,y,conditions);portal(b,a,8,12);};
link('school-grounds','school-hall',8,4,[flag('story.tour.invited')]);
link('school-hall','school-second-floor',12,4,[flag('story.tour.invited')]);
link('school-second-floor','school-third-floor',12,4,[flag('story.tour.invited')]);
link('school-third-floor','principal-office',12,4,[flag('story.tour.invited')]);
link('school-hall','homeroom',4,5,[flag('story.enrolled')]);
link('school-grounds','shopping-district',14,8,[flag('story.enrolled')]);
link('shopping-district','magic-item-shop',8,4);
link('school-grounds','school-colosseum',3,6,[flag('story.enrolled')]);
for(const [i,o] of c.origins.entries())link('school-grounds',o.mapId.slice(4),5+i*3,12,[flag('story.home-visit'),{type:'element',value:o.element}]);
link('school-hall','cafeteria',4,8,[flag('story.enrolled')]);
link('school-hall','school-basement',13,9,[flag('story.basement-invited')]);
link('school-basement','basement-shortcut',10,5,[flag('story.jar-moved')]);
link('basement-shortcut','oak-forest',12,4,[flag('story.breadcrumbs-followed')]);
link('oak-forest','odangka-cabin',9,4);
portal('oak-forest','school-grounds',14,8,[flag('story.shiva-flight')],'Fly with Shiva');
for(const [i,id] of ['flame-classroom','ice-classroom','earth-classroom','non-elemental-classroom'].entries())link('school-second-floor',id,4+i*3,5,[flag('story.enrolled')]);
link('school-grounds','pet-center',3,9,[flag('story.duel.done')]);link('shopping-district','health-center',13,7);link('school-hall','dormitory',4,10,[flag('story.enrolled')]);
// Shou waits in the hall until the home visit; each homeland has its own return route.
getMap('school-hall').npcs.push({actorId:'npc.shou',position:pos(5,8),conditions:[flag('story.enrolled')]});
function quest(id,episodeNumber,name,summary,prerequisites,steps,rewards,source=narrative(episodeNumber)){
 c.quests.push({id,episodeNumber,name,summary,prerequisites,steps,rewards,repeatable:false,...source,balanceNotes:'English wording, map coordinates, triggers, starting resources, EXP and currency amounts are RESTORATION. Historical unknowns remain in the research dossier.'});
}
function step(id,label,mapId,type,targetId,speaker,text,effects=[],conditions=[],source=authored){return {id,label,mapId:'map.'+mapId,type,targetId,conditions,effects,...source,...(text?{dialogueId:dialogue('dialogue.'+id,speaker,text)}:{})};}
quest('quest.main.000',0,'First Day at Magic School','Meet George and follow Skoll through the school to Principal Morris.',[],[
 step('arrival.george','Introduce yourself to George','school-grounds','TALK','npc.george','npc.george',['A new student? Welcome. Magic takes patience—and a little courage.','I keep these paths tidy. Skoll can show you the school.'],[],[],narrative(0)),
 step('arrival.skoll','Meet Skoll by the school entrance','school-grounds','TALK','npc.skoll','npc.skoll',['I teach Ice magic. Weren’t you speaking to a rabbit earlier?','Come along. The principal is upstairs.'],[tx({'story.tour.invited':true})],[],narrative(0)),
 step('arrival.hall','Enter the school hall','school-hall','ENTER_MAP','map.school-hall','npc.skoll',['Four floors above, a basement below. You’ll learn your way around.'],[],[],narrative(0)),
 step('arrival.second','Follow the stairs to the second floor','school-second-floor','ENTER_MAP','map.school-second-floor','npc.skoll',['The classrooms are here. Lessons will help your magic grow.'],[],[],narrative(0)),
 step('arrival.third','Continue to the third floor','school-third-floor','ENTER_MAP','map.school-third-floor','npc.skoll',['Those rooms are sealed. Perhaps you’ll see what is inside one day.'],[],[],narrative(0)),
 step('arrival.morris','Introduce yourself to Principal Morris','principal-office','TALK','npc.morris','npc.morris',['A child who can speak with rabbits has promise.','Your entrance was your first step as our student. Welcome to Arpia!'],[],[],narrative(0)),
],[tx({'story.enrolled':true},{},0,4),{type:'exp',amount:30}]);
for(const origin of c.origins){
 const e=origin.element.toLowerCase();
 quest('quest.main.001.'+e,1,'Friendly Showdown — My Friend Kesno','Visit home, receive Samuel’s wand, and face your friend in a school duel.',[flag('story.enrolled'),{type:'element',value:origin.element}],[
  step('duel.'+e+'.mina','Ask Mina who is looking for you','school-grounds','TALK','npc.mina','npc.mina',['Julia wants to see you. It sounds important.']),
  step('duel.'+e+'.julia','Meet Julia in your classroom','homeroom','TALK','npc.julia','npc.julia',['The principal has an opportunity for you. Go and hear him out.']),
  step('duel.'+e+'.morris','Hear the principal’s challenge','principal-office','TALK','npc.morris','npc.morris',['You and Kesno will have a friendly magical duel.','Visit home with Shou first. Then collect your wand from Samuel.'],[tx({'story.home-visit':true})]),
  step('duel.'+e+'.shou','Meet Shou in the school hall','school-hall','TALK','npc.shou','npc.shou',['Ready for a trip home? Your village is marked on the grounds.']),
  step('duel.'+e+'.chief','Greet your village chief',origin.mapId.slice(4),'TALK','npc.chief','npc.chief',['Welcome home. We’re eager to see what you learn at Arpia.']),
  step('duel.'+e+'.family','Visit your family',origin.mapId.slice(4),'TALK','npc.family','npc.family',['Make us proud—and remember that Kesno is your friend.']),
  step('duel.'+e+'.wand','Collect a wand from Samuel','magic-item-shop','TALK','npc.samuel','npc.samuel',['Here is your wand. I can’t decide which of you to cheer for!'],[tx({}, {'item.wand':1}),{type:'starterPet'}]),
  step('duel.'+e+'.kesno','Meet Kesno at the Colosseum','school-colosseum','TALK','npc.kesno','npc.kesno',['Friends or not, I’m giving this my best. Meet me in the ring.'],[tx({'story.duel.ready':true})]),
  step('duel.'+e+'.battle','Win the friendly duel','school-colosseum','BATTLE','battle.kesno','npc.kesno',['Good match! Let’s hear what the principal thinks.']),
  step('duel.'+e+'.recognition','Return to Principal Morris','principal-office','TALK','npc.morris','npc.morris',['Both of you showed spirit. You have earned my recognition.']),
 ],[tx({'story.duel.done':true},{},35,8),{type:'exp',amount:60},{type:'restore'}]);
}
quest('quest.main.002',2,'The Wizard of Oak Forest — Odangka','Isaac’s discovery leads beyond the school, where a strange drought needs investigating.',[flag('story.duel.done')],[
 step('forest.mina','Speak to Mina','school-grounds','TALK','npc.mina','npc.mina',['Find Isaac in the hall. Julia is waiting for you both.']),
 step('forest.isaac','Meet Isaac in the school hall','school-hall','TALK','npc.isaac','npc.isaac',['Come on. We’d better see Julia first.'],[{type:'companion',actorId:'npc.isaac',join:true}]),
 step('forest.julia','Report to Julia','homeroom','TALK','npc.julia','npc.julia',['Weila is suffering a drought. Please take water conservation seriously.']),
 step('forest.shortcut','Hear Isaac’s discovery','school-hall','TALK','npc.isaac','npc.isaac',['I found something under a storage jar. Grab some bread, then follow me!'],[tx({'story.basement-invited':true})]),
 step('forest.bread','Collect bread in the cafeteria','cafeteria','INTERACT','object.bread','npc.isaac',['Yesterday’s bread. Excellent for marking our way.'],[tx({}, {'item.bread':1})]),
 step('forest.jar','Move the heavy jar in the basement','school-basement','INTERACT','object.jar','npc.isaac',['Push! There’s the opening.'],[tx({'story.jar-moved':true})],[{type:'inventory',id:'item.bread',quantity:1}]),
 step('forest.crumbs','Follow the breadcrumbs through the shortcut','basement-shortcut','INTERACT','object.breadcrumbs','npc.isaac',['My breadcrumbs lead to the exit. It’s farther than it looks.'],[tx({'story.breadcrumbs-followed':true},{'item.bread':-1})]),
 step('forest.eagle','Free the trapped Baby Eagle','oak-forest','INTERACT','object.eagle-trap','narrator',['The trap opens. The young eagle is free.'],[tx({'story.eagle-rescued':true})]),
 step('forest.odangka','Visit the cabin','odangka-cabin','TALK','npc.odangka','npc.odangka',['The oaks shall drink the river dry!'],[tx({'story.odangka-seen':true})]),
 step('forest.shiva','Speak to Shiva outside','oak-forest','TALK','npc.shiva','npc.shiva',['Thank you for saving the little one. Odangka is not himself.','Climb aboard. Tell Morris what you found.'],[tx({'story.shiva-flight':true}),{type:'pet',petId:'pet.baby-eagle'}]),
 step('forest.morris','Tell Principal Morris about Odangka','principal-office','TALK','npc.morris','npc.morris',['Take this medicine. Aaron will help you give it to Odangka.'],[tx({}, {'item.medicine':1})]),
 step('forest.aaron','Ask Aaron to accompany you','flame-classroom','TALK','npc.aaron','npc.aaron',['I’ll come. Use the shortcut and meet me at the cabin.'],[{type:'companion',actorId:'npc.aaron',join:true},tx({'story.odangka.battle-ready':true})]),
 step('forest.battle','Subdue Odangka with Isaac and Aaron','odangka-cabin','BATTLE','battle.odangka','npc.aaron',['Now—the medicine!']),
 step('forest.medicine','Give Odangka the medicine','odangka-cabin','TALK','npc.odangka','npc.odangka',['What have I done? Please give Morris my apologies.'],[tx({'story.drought-ended':true},{'item.medicine':-1})],[{type:'inventory',id:'item.medicine',quantity:1}]),
 step('forest.report','Report back to Principal Morris','principal-office','TALK','npc.morris','npc.morris',['You helped Weila and a friend in need. Well done.']),
],[tx({'story.forest.done':true},{},50,12),{type:'exp',amount:100},{type:'companion',actorId:'npc.isaac',join:false},{type:'companion',actorId:'npc.aaron',join:false},{type:'restore'}]);
for(const [id,name,enemy,mapId,conditions,canEscape] of [['kesno','Friendly duel',['npc.kesno'],'school-colosseum',[flag('story.duel.ready')],false],['odangka','The troubled forest wizard',['npc.odangka'],'odangka-cabin',[flag('story.odangka.battle-ready')],false]]){
 c.battles.push({id:'battle.'+id,name,enemyIds:enemy,backgroundAssetId:'map.'+(id==='kesno'?'arena':'forest')+'.background',canEscape,rewards:[],...narrative(id==='kesno'?1:2),balanceEvidence:authored});
 getMap(mapId).encounters.push({id:'encounter.'+id,battleId:'battle.'+id,position:pos(10,8),conditions});
}
const service=(id,actorId,mapId,name,kind,extra={})=>c.services.push({id:'service.'+id,actorId:'npc.'+actorId,mapId:'map.'+mapId,name,kind,itemIds:[],pinCost:0,virtueCost:0,lessonCount:1,conditions:[flag('story.enrolled')],...extra,...authored,balanceEvidence:authored});
service('supplies','samuel','magic-item-shop','Magic supplies','SHOP',{itemIds:['item.small-tonic','item.mana-tonic','item.antidote','item.revive-tonic','item.wand']});
for(const [actorId,mapId,spell] of [['esta','flame-classroom','fire-arrow'],['skoll','ice-classroom','ice-spear'],['ishubike','earth-classroom','stone-hand'],['rie','non-elemental-classroom','healing']])service('lesson.'+spell,actorId,mapId,'Study '+c.spells.find(s=>s.id==='spell.'+spell).name,'LESSON',{spellId:'spell.'+spell,virtueCost:3,lessonCount:3});
service('recovery','hubert','health-center','Rest and recover','HEAL',{pinCost:5});
service('training','pelita','pet-center','Train the selected pet','PET_TRAIN',{pinCost:10});
// Only the opening is active. Later research catalog entries remain explicitly unplayable.
mkdirSync(join(root,'content/adventure'),{recursive:true});writeFileSync(join(root,'content/adventure/opening.json'),JSON.stringify(c,null,2)+'\n');
const manifestPath=join(root,'public/assets/packs/public/manifest.json');const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
for(const [key,base] of [['chief','samuel'],['family','julia']])for(const [kind,folder] of [['overworld','npcs'],['portrait','portraits']])manifest.assets[`npc.${key}.${kind}`]={...manifest.assets[`npc.${base}.${kind}`],path:`${folder}/${base}.svg`};
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(`Authored ${c.quests.length} quest branches, ${c.maps.length} maps and ${c.dialogue.length} dialogue sequences for Episodes 0–2.`);
