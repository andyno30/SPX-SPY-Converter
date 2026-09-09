// Executable retellings of the next three documented stories. Not archival dialogue or map data.
export function extendFirstJourneys(c,h){
 const {actor,map,portal,link,getMap,quest,step,tx,flag,item,ev,authored,stats}=h;
 const narrative=(number)=>ev('wonavy-'+({3:190,4:205,5:206}[number]),`Episode ${number} narrative`,'Narrated event order and named participants. Coordinates, English lines, trigger logic and numbers are authored restoration.');
 for(const [key,name,element] of [['matilda','Matilda'],['conrad','Conrad'],['caesar-iii','Caesar III'],['edward','Edward'],['hina','Hina'],['amela','Amela'],['douglas','Douglas'],['murphy','Murphy'],['chili','Chili'],['baldi','Baldi'],['kobold','Kobold'],['naomi','Naomi','ICE'],['leona','Leona'],['muhammad-ali-iv','Muhammad Ali IV'],['kadija','Kadija']])actor(key,name,element??'NONE');
 actor('scorpion','Basement scorpion','EARTH',stats(65,0,13,6,6,5,6));
 for(const [id,name,description] of [
  ['royal-invitation','Royal invitation','Addressed to you from Deron Kingdom.'],['cross-stitch','Morris’s cross-stitch','A gift for Caesar III.'],['school-badge','School badge','An Arpia student’s badge.'],
  ['resin-powder','Resin powder','Chili’s material for the crescent door.'],['cold-medicine','Cold medicine','Amela prepared this for Kobold.'],['firewood','Firewood','Dry wood from the basement store.'],['murphy-scroll','Murphy’s scroll','A scroll for an advanced magic teacher; its exact spell reward is unresolved.'],
  ['matilda-letter','Matilda’s letter','A letter for her father.'],['kadija-letter','Kadija’s letter','A complaint about repeated yogurt parcels.'],['testing-powder','Leona’s powder','Reacts when a sword has been altered.'],['yogurt','The last yogurt','Skoll insists on delivering this one personally.'],
 ])item(id,name,'QUEST',0,0,description);
 map('post-office','School post office','SHOP',[['conrad',8,5]]);link('shopping-district','post-office',4,5);
 map('deron-palace','Deron Kingdom · Palace','OFFICE',[['caesar-iii',8,5]]);
 map('deron-arena','Deron Kingdom · Arena','ARENA',[['matilda',7,6],['edward',11,8]]);
 map('wizard-city','Wizard City','VILLAGE',[['matilda',8,6]]);
 link('school-grounds','deron-palace',15,11,[flag('story.royal-journey')]);link('deron-palace','deron-arena',12,4,[flag('story.royal-audience')]);link('deron-palace','wizard-city',4,5,[flag('story.matilda-search')]);
 getMap('deron-arena').npcs[0].conditions=[flag('story.matilda-fled',false)];
 getMap('wizard-city').npcs[0].conditions=[flag('story.matilda-student',false)];
 getMap('school-grounds').npcs.push({actorId:'npc.matilda',position:{x:10,y:9},conditions:[flag('story.matilda-student')]});
 quest('quest.main.003',3,'Tomboy Princess Matilda — I Want to Be a Wizard','A royal invitation introduces a princess determined to study magic.',[flag('story.forest.done')],[
  step('royal.george','Check George’s news','school-grounds','TALK','npc.george','npc.george',['Mail with your name on it. Conrad has it.']),
  step('royal.mail','Collect the invitation','post-office','TALK','npc.conrad','npc.conrad',['A royal seal! Handle this carefully.'],[tx({}, {'item.royal-invitation':1})]),
  step('royal.julia','Consult Julia','homeroom','TALK','npc.julia','npc.julia',['Take this straight to the principal.']),
  step('royal.morris','Prepare to visit Deron','principal-office','TALK','npc.morris','npc.morris',['Go with my blessing. And take my gift.'],[tx({'story.royal-journey':true},{'item.cross-stitch':1,'item.school-badge':1})]),
  step('royal.king','Attend the royal audience','deron-palace','TALK','npc.caesar-iii','npc.caesar-iii',['Our people would like to meet you at the arena.'],[tx({'story.royal-audience':true},{'item.cross-stitch':-1,'item.royal-invitation':-1})]),
  step('royal.princess','Meet Matilda at the arena','deron-arena','TALK','npc.matilda','npc.matilda',['I want to study magic. Why won’t Father listen?'],[tx({'story.matilda-fled':true})]),
  step('royal.edward','Ask Edward where she went','deron-arena','TALK','npc.edward','npc.edward',['Try Wizard City, south of the palace.'],[tx({'story.matilda-search':true})]),
  step('royal.badge','Find Matilda in Wizard City','wizard-city','TALK','npc.matilda','npc.matilda',['May I borrow that lovely badge?','Grikor Ujilata!'],[tx({'story.matilda-student':true},{'item.school-badge':-1})],[{type:'inventory',id:'item.school-badge',quantity:1}]),
  step('royal.explain','Explain the disappearance to Caesar','deron-palace','TALK','npc.caesar-iii','npc.caesar-iii',['She has gone to Arpia? Speak to Morris.']),
  step('royal.enroll','Return to Principal Morris','principal-office','TALK','npc.morris','npc.morris',['Matilda has promise. She’ll study here.']),
 ],[tx({'story.matilda.done':true},{},25,6),{type:'exp',amount:75}],narrative(3));
 // The basement route is an explicitly authored small graph until original room topology is recovered.
 map('school-infirmary','School infirmary','HALL',[['amela',8,5],['hina',11,8]]);link('school-hall','school-infirmary',14,6,[flag('story.enrolled')]);
 map('school-restroom','School restroom corridor','HALL',[['douglas',7,5]]);link('school-hall','school-restroom',14,10,[flag('story.echoes-started')]);
 map('boiler-room','School boiler room','BASEMENT',[['murphy',7,6]]);link('school-basement','boiler-room',4,4,[flag('story.boiler-lead')]);
 map('basement-stairs','Basement · Secret staircase','MAZE',[],[['object.crescent-door','Crescent stone door',10,5]]);link('boiler-room','basement-stairs',12,4,[flag('story.secret-stairs')]);
 map('kobold-room','Kobold’s room','BASEMENT',[['kobold',7,5]],[['object.hearth','Cold hearth',11,6]]);link('basement-stairs','kobold-room',12,4,[flag('story.crescent-open')]);
 map('wood-store','Basement wood store','BASEMENT',[],[['object.firewood','Dry firewood',7,5]]);link('kobold-room','wood-store',12,4,[flag('story.kobold-fed')]);
 map('materials-classroom','Magic materials classroom','CLASSROOM',[['chili',8,5]]);link('school-second-floor','materials-classroom',14,8,[flag('story.enrolled')]);
 map('dwarf-mine','Dwarf Mine · Entrance','VILLAGE',[['baldi',7,6],['naomi',10,8],['skoll',12,6]],[['object.mine-swords','Dwarf-forged swords',6,4]]);link('school-grounds','dwarf-mine',2,11,[flag('story.mine-route')]);
 getMap('dwarf-mine').npcs.find(n=>n.actorId==='npc.naomi').conditions=[flag('story.sword-inquiry')];getMap('dwarf-mine').npcs.find(n=>n.actorId==='npc.skoll').conditions=[flag('story.mine-tested')];
 getMap('school-grounds').npcs.push({actorId:'npc.hina',position:{x:5,y:8},conditions:[flag('story.matilda.done')]});
 const door=step('echoes.phrase','Speak the words at the crescent door','basement-stairs','TYPE_PHRASE','object.crescent-door','narrator',['The stone door opens.'],[tx({'story.crescent-open':true},{'item.resin-powder':-1})],[{type:'inventory',id:'item.resin-powder',quantity:1}]);door.phrase='Open';
 quest('quest.main.004',4,'Echoes from the Restroom','Follow a strange noise into the school basement and help its source.',[flag('story.matilda.done')],[
  step('echoes.hina','Find out what troubles Hina','school-grounds','TALK','npc.hina','npc.hina',['Come to the infirmary with me.'],[tx({'story.echoes-started':true}),{type:'companion',actorId:'npc.hina',join:true}]),
  step('echoes.amela','Ask Amela about the noise','school-infirmary','TALK','npc.amela','npc.amela',['Something has been crying beneath the restroom.']),
  step('echoes.douglas','Investigate the restroom corridor','school-restroom','TALK','npc.douglas','npc.douglas',['Murphy knows the pipes. Ask him.'],[tx({'story.boiler-lead':true,'story.basement-invited':true})]),
  step('echoes.murphy','Find Murphy in the boiler room','boiler-room','TALK','npc.murphy','npc.murphy',['Kobold lives below us. Take the secret stairs.'],[tx({'story.secret-stairs':true})]),
  step('echoes.door','Inspect the locked stone door','basement-stairs','INTERACT','object.crescent-door','narrator',['A crescent marks the sealed door.']),
  step('echoes.material','Return to Murphy','boiler-room','TALK','npc.murphy','npc.murphy',['Chili may have the material you need.'],[tx({'story.mine-route':true})]),
  step('echoes.chili','Collect resin powder','materials-classroom','TALK','npc.chili','npc.chili',['Baldi remembers the words. I have the powder.'],[tx({}, {'item.resin-powder':1})]),
  step('echoes.baldi','Learn the opening words','dwarf-mine','TALK','npc.baldi','npc.baldi',['The word is “Open”. Say it at the door.']),
  step('echoes.bread-tip','Check back with Murphy','boiler-room','TALK','npc.murphy','npc.murphy',['Bring bread. Kobold must be hungry.']),
  step('echoes.bread','Take bread from the cafeteria','cafeteria','INTERACT','object.bread','narrator',['You take some bread.'],[tx({}, {'item.bread':1})]),door,
  step('echoes.kobold','Give Kobold the bread','kobold-room','TALK','npc.kobold','npc.kobold',['Cold… Scorpions block my firewood.'],[tx({'story.kobold-fed':true},{'item.bread':-1})],[{type:'inventory',id:'item.bread',quantity:1}]),
  step('echoes.medicine','Collect medicine from Amela','school-infirmary','TALK','npc.amela','npc.amela',['This should help. Keep him warm.'],[tx({}, {'item.cold-medicine':1})]),
  step('echoes.treat','Treat Kobold’s cold','kobold-room','TALK','npc.kobold','npc.kobold',['Thank you. Now for that fire…'],[tx({'story.scorpions-ready':true},{'item.cold-medicine':-1})],[{type:'inventory',id:'item.cold-medicine',quantity:1}]),
  step('echoes.scorpions','Clear the way to the wood','wood-store','BATTLE','battle.scorpions','narrator',['The way to the firewood is clear.'],[tx({'story.wood-clear':true})]),
  step('echoes.firewood','Collect the dry firewood','wood-store','INTERACT','object.firewood','narrator',['You gather dry wood.'],[tx({}, {'item.firewood':1})],[flag('story.wood-clear')]),
  step('echoes.hearth','Light Kobold’s hearth','kobold-room','INTERACT','object.hearth','npc.kobold',['Warm at last!'],[tx({'story.hearth-lit':true},{'item.firewood':-1})],[{type:'inventory',id:'item.firewood',quantity:1}]),
  step('echoes.scroll','Tell Murphy the noise has stopped','boiler-room','TALK','npc.murphy','npc.murphy',['Take this scroll for your kindness.'],[tx({}, {'item.murphy-scroll':1})]),
 ],[tx({'story.echoes.done':true},{},35,9),{type:'exp',amount:100},{type:'companion',actorId:'npc.hina',join:false},{type:'restore'}],narrative(4));
 c.battles.push({id:'battle.scorpions',name:'Scorpions in the wood store',enemyIds:['npc.scorpion','npc.scorpion'],backgroundAssetId:'map.basement.background',canEscape:true,rewards:[],...narrative(4),balanceEvidence:authored});
 getMap('wood-store').encounters.push({id:'encounter.scorpions',battleId:'battle.scorpions',position:{x:10,y:8},conditions:[flag('story.scorpions-ready')]});
 getMap('wood-store').objects[0].conditions=[flag('story.wood-clear')];
 getMap('ice-classroom').objects.push({id:'object.skolls-desk',name:'Skoll’s empty desk',assetId:'icon.object',position:{x:8,y:5},conditions:[flag('story.skoll-away')]});
 for(const m of ['school-hall','school-third-floor','ice-classroom'])for(const n of getMap(m).npcs)if(n.actorId==='npc.skoll')n.conditions.push(flag('story.skoll-away',false));
 // The scroll's historical spell is unknown; keep it instead of inventing a reward identity.
 map('advanced-ice-classroom','Advanced Ice classroom','CLASSROOM',[['naomi',8,5]]);link('school-second-floor','advanced-ice-classroom',14,10,[flag('story.echoes.done')]);
 map('nymphen','Nymphen · Fairy Island','FOREST',[['leona',7,5]]);link('school-grounds','nymphen',2,5,[flag('story.sword-inquiry')]);
 map('asuria-palace','Asuria Kingdom · Palace','OFFICE',[['muhammad-ali-iv',8,5],['naomi',10,8],['skoll',6,8]],[['object.asuria-swords','Asuria’s damaged swords',7,4]]);link('dwarf-mine','asuria-palace',14,5,[flag('story.asuria-route')]);
 map('kadija-house','Kadija’s house','OFFICE',[['kadija',7,5],['skoll',10,8]]);link('asuria-palace','kadija-house',12,4,[flag('story.last-yogurt')]);
 quest('quest.main.005',5,'Kadija’s Letter','A postal errand opens an investigation into mysterious parcels and damaged swords.',[flag('story.echoes.done')],[
  step('letter.matilda','Take Matilda’s letter','school-grounds','TALK','npc.matilda','npc.matilda',['Would you post this for Father?'],[tx({}, {'item.matilda-letter':1})]),
  step('letter.conrad','Deliver the letter to Conrad','post-office','TALK','npc.conrad','npc.conrad',['Call me Miss Conrad. Look at this complaint.'],[tx({'story.skoll-away':true}, {'item.matilda-letter':-1,'item.kadija-letter':1})]),
  step('letter.skoll','Look for Skoll','ice-classroom','INTERACT','object.skolls-desk','narrator',['Skoll is away. Try Naomi’s classroom.']),
  step('letter.naomi','Consult Naomi','advanced-ice-classroom','TALK','npc.naomi','npc.naomi',['We should ask the shop about yogurt buyers.'],[{type:'companion',actorId:'npc.naomi',join:true}]),
  step('letter.samuel','Ask Samuel about recent purchases','magic-item-shop','TALK','npc.samuel','npc.samuel',['Isaac and Skoll bought yogurt recently.']),
  step('letter.isaac','Ask Isaac about the parcels','school-hall','TALK','npc.isaac','npc.isaac',['Mine was for me. Amela can tell you.']),
  step('letter.hina','Hear Hina’s urgent message','school-grounds','TALK','npc.hina','npc.hina',['Julia needs you. Hurry!']),
  step('letter.julia','Learn about the sword dispute','homeroom','TALK','npc.julia','npc.julia',['Investigate the swords. Leona can help.'],[tx({'story.sword-inquiry':true})]),
  step('letter.leona','Collect Leona’s testing powder','nymphen','TALK','npc.leona','npc.leona',['Test the metal at both ends of its journey.'],[tx({}, {'item.testing-powder':2})]),
  step('letter.baldi','Question Baldi at the mine','dwarf-mine','TALK','npc.baldi','npc.baldi',['We stand behind our work. Test it.']),
  step('letter.mine-test','Test the mine’s swords','dwarf-mine','INTERACT','object.mine-swords','narrator',['The powder shows no unusual reaction.'],[tx({'story.mine-tested':true},{'item.testing-powder':-1})],[{type:'inventory',id:'item.testing-powder',quantity:1}]),
  step('letter.confession','Hear Skoll’s explanation','dwarf-mine','TALK','npc.skoll','npc.skoll',['Yes, I sent them. But first, the swords.'],[tx({'story.asuria-route':true}),{type:'companion',actorId:'npc.skoll',join:true}]),
  step('letter.king','Visit Asuria’s ruler','asuria-palace','TALK','npc.muhammad-ali-iv','npc.muhammad-ali-iv',['See how easily they break.']),
  step('letter.asuria-test','Test the damaged swords','asuria-palace','INTERACT','object.asuria-swords','narrator',['This time the powder reacts. Something changed.'],[tx({'story.swords-altered':true},{'item.testing-powder':-1})],[{type:'inventory',id:'item.testing-powder',quantity:1}]),
  step('letter.last-parcel','Speak to Skoll outside the audience','asuria-palace','TALK','npc.skoll','npc.skoll',['The fourteenth yogurt must be delivered in person.'],[tx({'story.last-yogurt':true},{'item.yogurt':1})]),
  step('letter.kadija','Visit Kadija with Skoll','kadija-house','TALK','npc.kadija','npc.kadija',['Is this really how wizards spend their time?'],[tx({}, {'item.yogurt':-1,'item.kadija-letter':-1})]),
 ],[tx({'story.kadija.done':true,'story.skoll-away':false},{},40,10),{type:'exp',amount:100},{type:'companion',actorId:'npc.skoll',join:false},{type:'companion',actorId:'npc.naomi',join:false},{type:'restore'}],narrative(5));
}
