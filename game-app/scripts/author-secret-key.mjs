// Episode 6 event order follows Wonavy 207. English dialogue and travel geometry are original restoration.
export function extendSecretKey(c,h){
 const {actor,map,link,getMap,quest,step,tx,flag,item,ev,stats}=h;
 const source=ev('wonavy-207','Episode 6 narrative','Key, postcard, eagle village, Jackal recruitment and charcoal negotiation; exact triggers, party handoffs and rewards are not documented.');
 actor('garuda','Garuda');actor('dobiel','Dobiel');actor('jackal','Jackal','NONE',stats(230,30,28,18,15,16,8));
 item('secret-key','Secret key','QUEST',0,0,'A small key from the chest Principal Morris asked you to open.');
 item('morris-postcard','Morris’s postcard','QUEST',0,0,'A message for Garuda in Eagle Village.');
 map('basement-key-room','School basement · Right-hand chamber','BASEMENT',[],[['object.secret-chest','Small wooden chest',7,5]]);
 link('basement-shortcut','basement-key-room',14,7,[flag('story.key-chamber')]);
 map('eagle-village','Eagle Village','VILLAGE',[['shiva',6,8],['garuda',10,5]]);
 link('oak-forest','eagle-village',4,5,[flag('story.eagle-journey')]);
 map('jackal-waterfall','Jackal’s Waterfall','FOREST',[['dobiel',7,6],['shiva',11,9]]);
 link('eagle-village','jackal-waterfall',12,4,[flag('story.waterfall-flight')]);
 map('jackal-den','The den beneath the waterfall','FOREST',[['jackal',8,5]]);
 link('jackal-waterfall','jackal-den',8,4,[flag('story.wake-jackal')]);
 getMap('jackal-den').npcs[0].conditions=[flag('story.jackal-joined',false)];
 getMap('basement-key-room').objects[0].conditions=[flag('story.secret-key-found',false)];
 quest('quest.main.006',6,'The Secret Key','Morris sends you to seek an old friend before the mine investigation can continue.',[flag('story.kadija.done')],[
  step('key.julia','Report the sword findings to Julia','homeroom','TALK','npc.julia','npc.julia',['The trouble reaches beyond a broken sword. Morris must hear this.']),
  step('key.morris','Hear the principal’s instructions','principal-office','TALK','npc.morris','npc.morris',['The right-hand chamber off Isaac’s basement passage is open. Bring back what lies in its chest.'],[tx({'story.key-chamber':true})]),
  step('key.chest','Open the chest in the right-hand chamber','basement-key-room','INTERACT','object.secret-chest','narrator',['Among the dust lies a small key.'],[tx({'story.secret-key-found':true},{'item.secret-key':1})]),
  step('key.naomi','Ask Naomi where Skoll has gone','advanced-ice-classroom','TALK','npc.naomi','npc.naomi',['Back to Asuria, of course. Kadija again! I’ll come with you to Morris.'],[tx({'story.skoll-away':true}),{type:'companion',actorId:'npc.naomi',join:true}]),
  step('key.postcard','Collect Morris’s message for Garuda','principal-office','TALK','npc.morris','npc.morris',['Keep the key safe. Give this postcard to Garuda in Eagle Village.'],[tx({'story.eagle-journey':true},{'item.morris-postcard':1})],[{type:'inventory',id:'item.secret-key',quantity:1}]),
  step('key.shiva','Greet Shiva in Eagle Village','eagle-village','TALK','npc.shiva','npc.shiva',['Back for another flight? Garuda is just ahead.']),
  step('key.garuda','Deliver the postcard to Garuda','eagle-village','TALK','npc.garuda','npc.garuda',['Morris is asking for an old friend. Shiva will take you to Jackal’s Waterfall.'],[tx({'story.waterfall-flight':true},{'item.morris-postcard':-1})],[{type:'inventory',id:'item.morris-postcard',quantity:1}]),
  step('key.dobiel','Speak to Dobiel at the waterfall','jackal-waterfall','TALK','npc.dobiel','npc.dobiel',['Quietly! Jackal is sleeping inside. If this is urgent, you had better explain yourself.'],[tx({'story.wake-jackal':true})]),
  step('key.jackal','Wake Jackal and explain Morris’s request','jackal-den','TALK','npc.jackal','npc.jackal',['Who disturbs my rest?','A friend of Morris? Then let us hear what is wrong at the mine.'],[tx({'story.jackal-joined':true}),{type:'companion',actorId:'npc.jackal',join:true}]),
  step('key.skoll','Meet Skoll at the mine entrance','dwarf-mine','TALK','npc.skoll','npc.skoll',['What an enormous pet—Jackal?! Forgive me!','I’ll lead from here. Naomi, will you keep Morris informed?'],[{type:'companion',actorId:'npc.naomi',join:false},{type:'companion',actorId:'npc.skoll',join:true}]),
  step('key.baldi','Negotiate entry with Baldi','dwarf-mine','TALK','npc.baldi','npc.baldi',['No visitors in the workings. Unless you can bring Kobold’s charcoal. That would be a fair trade.'],[tx({'story.charcoal-bargain':true})]),
  step('key.kobold','Ask Kobold for charcoal','kobold-room','TALK','npc.kobold','npc.kobold',['A tiger! Please keep those teeth over there.','You helped me, so take the charcoal from the other room.']),
 ],[tx({'story.secret-key.done':true},{},25,6),{type:'exp',amount:80},{type:'restore'}],source);
 // Keep the key and travelling companions for Episode 7. No guessed palace puzzle is activated here.
}
