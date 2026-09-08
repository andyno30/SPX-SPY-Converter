import {saveSchema,type Save} from '../src/game/engine/model.js';
/** Synthetic RESTORATION test state. These values are not historical Arpia stats. */
export function fixture():Save {return saveSchema.parse({
  saveSchemaVersion:1,revision:0,characterId:'11111111-1111-4111-8111-111111111111',
  character:{name:'Test Student',element:'FLAME',appearanceId:'fixture.player',level:1,rank:'APPRENTICE',exp:0},
  currencies:{pin:20,virtuePoints:10},inventory:{'fixture.resin':1},equipment:{},spells:{},pets:[],activePetIds:[],companionIds:[],
  world:{mapId:'fixture.school',x:0,y:0,flags:{},discoveredRooms:[],unlockedMaps:['fixture.school']},quests:{},
});}
