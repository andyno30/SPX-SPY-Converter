import Phaser from 'phaser';
import {AssetResolver} from '../game/engine/assets.js';
import {findPath,fromIso,toIso,type Grid,type Point} from '../game/engine/navigation.js';

export interface SceneWorld {
  grid:Grid;spawn:Point;playerAssetId:string;
  npcs:{id:string;name:string;position:Point;assetId:string;dialogueId:string}[];
}
/** Presentation adapter only. The host supplies researched geometry and approved assets.
 * No historical map or default geometry is implied by this foundation. */
export class ArpiaWorldScene extends Phaser.Scene {
  private actor?:Phaser.GameObjects.Image;
  private tile:Point;
  private path:Point[]=[];
  private walking=false;
  private npcSprites:{data:SceneWorld['npcs'][number];sprite:Phaser.GameObjects.Image}[]=[];
  constructor(private world:SceneWorld,private assets:AssetResolver,private onDialogue:(id:string)=>void){super('ArpiaWorld');this.tile={...world.spawn};}
  preload(){
    for(const id of new Set([this.world.playerAssetId,...this.world.npcs.map(n=>n.assetId)]))this.load.image(id,this.assets.resolve(id));
  }
  create(){
    const width=64,height=32;
    const origin={x:this.scale.width/2,y:64};
    const screen=(p:Point)=>{const iso=toIso(p,width,height);return{x:iso.x+origin.x,y:iso.y+origin.y};};
    const pos=screen(this.tile);
    this.actor=this.add.image(pos.x,pos.y,this.world.playerAssetId).setOrigin(.5,1);
    for(const npc of this.world.npcs){
      const p=screen(npc.position);const sprite=this.add.image(p.x,p.y,npc.assetId).setOrigin(.5,1);
      this.add.text(p.x,p.y-48,npc.name,{fontSize:'12px',color:'#ffffff',stroke:'#173752',strokeThickness:3}).setOrigin(.5);
      this.npcSprites.push({data:npc,sprite});
    }
    const click=(pointer:Phaser.Input.Pointer)=>{
      const target=fromIso({x:pointer.worldX-origin.x,y:pointer.worldY-origin.y},width,height);
      const tile={x:Math.round(target.x),y:Math.round(target.y)};
      const npc=this.world.npcs.find(n=>n.position.x===tile.x&&n.position.y===tile.y);
      if(npc&&Math.abs(this.tile.x-tile.x)+Math.abs(this.tile.y-tile.y)<=1){this.onDialogue(npc.dialogueId);return;}
      if(this.walking)return;
      this.path=(findPath(this.world.grid,this.tile,tile)??[]).slice(1);
    };
    this.input.on('pointerdown',click);
    const update=()=>{
      for(const {sprite} of this.npcSprites)sprite.setDepth(sprite.y);
      this.actor?.setDepth(this.actor.y);
      if(this.walking||!this.actor)return;
      const next=this.path.shift();if(!next)return;
      this.walking=true;
      const p=screen(next);
      this.tweens.add({targets:this.actor,x:p.x,y:p.y,duration:180,onComplete:()=>{this.tile=next;this.walking=false;}});
    };
    this.events.on(Phaser.Scenes.Events.UPDATE,update);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>{
      this.input.off('pointerdown',click);this.events.off(Phaser.Scenes.Events.UPDATE,update);
      this.tweens.killAll();this.path=[];this.walking=false;this.npcSprites=[];this.actor=undefined;
    });
  }
}
