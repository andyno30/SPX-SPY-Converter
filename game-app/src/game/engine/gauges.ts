export interface GaugeUnit { id:string;side:'ALLY'|'ENEMY';role:'PLAYER'|'PET'|'NPC'|'ENEMY';hp:number;gauge:number;rate:number;disabled:boolean }
/** Fixed simulation ticks; rates are injected restoration/measured values, never frame delta. */
export function tickGauges(units:GaugeUnit[],ticks:number):GaugeUnit[] {
  if(!Number.isSafeInteger(ticks)||ticks<0)throw new Error('Invalid ticks');
  if(new Set(units.map(u=>u.id)).size!==units.length)throw new Error('Duplicate combatant');
  const allies=units.filter(u=>u.side==='ALLY');
  if(allies.filter(u=>u.role==='PLAYER').length!==1||allies.filter(u=>u.role==='PET').length>2||allies.filter(u=>u.role==='NPC').length>2)throw new Error('Invalid party composition');
  return units.map(u=>{
    if(!Number.isFinite(u.rate)||u.rate<0||!Number.isFinite(u.hp)||!Number.isFinite(u.gauge)||u.gauge<0||u.gauge>100)throw new Error('Invalid gauge state');
    return {...u,gauge:u.hp<=0||u.disabled?u.gauge:Math.min(100,u.gauge+u.rate*ticks)};
  });
}
export function readyUnits(units:GaugeUnit[]):string[]{return units.filter(u=>u.hp>0&&!u.disabled&&u.gauge>=100).map(u=>u.id).sort();}
