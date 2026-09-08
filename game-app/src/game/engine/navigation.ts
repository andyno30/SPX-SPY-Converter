import { meets,type Condition,type Save } from './model.js';
export interface Point { x:number;y:number }
export interface Grid { width:number;height:number;blocked:Point[] }
const key=(p:Point)=>`${p.x},${p.y}`;
const inside=(g:Grid,p:Point)=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<g.width&&p.y<g.height;
/** Cardinal BFS on logical tiles; no corner cutting through collision. */
export function findPath(grid:Grid,start:Point,end:Point):Point[]|null {
  const blocked=new Set(grid.blocked.map(key));
  if(!inside(grid,start)||!inside(grid,end)||blocked.has(key(start))||blocked.has(key(end)))return null;
  const queue=[start], seen=new Map<string,Point|null>([[key(start),null]]);
  for(let i=0;i<queue.length;i++) {
    const p=queue[i]!;
    if(key(p)===key(end)) {
      const path:Point[]=[];let current:Point|null=p;
      while(current){path.push(current);current=seen.get(key(current))??null;}
      return path.reverse();
    }
    for(const n of [{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}])
      if(inside(grid,n)&&!blocked.has(key(n))&&!seen.has(key(n))){seen.set(key(n),p);queue.push(n);}
  }
  return null;
}
export const toIso=(p:Point,tileWidth:number,tileHeight:number):Point=>({x:(p.x-p.y)*tileWidth/2,y:(p.x+p.y)*tileHeight/2});
export const fromIso=(p:Point,tileWidth:number,tileHeight:number):Point=>({x:p.x/tileWidth+p.y/tileHeight,y:p.y/tileHeight-p.x/tileWidth});
export interface Maze { id:string;rooms:string[];connections:{id:string;from:string;to:string;conditions:Condition[]}[] }
export function traverseMaze(state:Save,maze:Maze,room:string,door:string):{room:string;discoveredRooms:string[]}|null {
  if(!maze.rooms.includes(room))return null;
  const edge=maze.connections.find(e=>e.id===door&&e.from===room);
  if(!edge||!maze.rooms.includes(edge.to)||!edge.conditions.every(c=>meets(state,c)))return null;
  return {room:edge.to,discoveredRooms:[...new Set([...state.world.discoveredRooms,room,edge.to])]};
}
