import { meets, type Save, type Condition } from './model.js';
import { transact, type Transaction } from './transactions.js';

export interface QuestEvent { id:string; type:'TALK'|'ENTER_MAP'|'INTERACT'|'TYPE_PHRASE'|'BATTLE'; targetId:string; phrase?:string }
export interface QuestStep {
  id:string; event: Omit<QuestEvent,'id'>; conditions:Condition[]; effects:Transaction; dialogueId?:string;
}
export interface QuestDefinition { id:string; prerequisites:Condition[]; steps:QuestStep[]; rewards:Transaction }

/** Consumes only the current step. Event IDs make reward replays harmless. */
export function advanceQuest(state:Save,quest:QuestDefinition,event:QuestEvent):Save {
  const progress=state.quests[quest.id]??{stepIndex:0,completed:false,processedEventIds:[]};
  if(progress.completed||progress.processedEventIds.includes(event.id)||!quest.prerequisites.every(c=>meets(state,c))) return state;
  const step=quest.steps[progress.stepIndex];
  if(!step||step.event.type!==event.type||step.event.targetId!==event.targetId||!step.conditions.every(c=>meets(state,c))) return state;
  // Literal historical/localized phrase comparison. Do not silently normalize puzzle answers.
  if(step.event.type==='TYPE_PHRASE' && (!step.event.phrase || step.event.phrase!==event.phrase)) return state;
  let next=transact(state,step.effects);
  const completed=progress.stepIndex+1===quest.steps.length;
  if(completed) next=transact(next,quest.rewards);
  next.quests[quest.id]={stepIndex:progress.stepIndex+1,completed,processedEventIds:[...progress.processedEventIds,event.id]};
  return next;
}

export function unmetConditions(state:Save,quest:QuestDefinition):Condition[] {
  const progress=state.quests[quest.id];
  if(progress?.completed) return [];
  return [...quest.prerequisites,...(quest.steps[progress?.stepIndex??0]?.conditions??[])].filter(c=>!meets(state,c));
}
