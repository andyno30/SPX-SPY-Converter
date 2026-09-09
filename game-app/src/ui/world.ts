import * as Phaser from 'phaser';
import {AssetResolver} from '../game/engine/assets';
import {findPath,fromIso,toIso,type Point} from '../game/engine/navigation';
import {AdventureSession,mapFor,visibleTargets,type Command} from '../game/adventure/session';
import {currentStep} from '../game/adventure/state';

const iso=(p:Point)=>{const v=toIso(p,48,24);return {x:v.x+432,y:v.y+76};};
export interface WorldView {destroy():void;approach(id:string):void}
export function createWorld(parent:HTMLElement,session:AdventureSession,assets:AssetResolver,onError:(message:string)=>void):WorldView {
  let scene:SchoolScene|undefined;
  class SchoolScene extends Phaser.Scene {
    private worldKey='';private figures=new Map<string,Phaser.GameObjects.Image>();
    private layers:Phaser.GameObjects.GameObject[]=[];private walking=false;private routeVersion=0;
    private player?:Phaser.GameObjects.Image;private off?:()=>void;
    private disposed=false;
    private previousHP=new Map<string,number>();
    preload(){for(const [id,a] of Object.entries(assets.manifest.assets))if(a.type==='image')this.load.svg(id,assets.resolve(id));}
    create(){
      scene=this;this.cameras.main.setBackgroundColor('#d8e8d6');
      this.off=session.subscribe(()=>this.sync());this.sync();
      this.input.on('pointerdown',(p:Phaser.Input.Pointer,objects:Phaser.GameObjects.GameObject[])=>{
        if(objects.length||p.y>510)return;
        const raw=fromIso({x:p.x-432,y:p.y-76},48,24);this.walk({x:Math.round(raw.x),y:Math.round(raw.y)});
      });
      this.input.keyboard?.on('keydown',(e:KeyboardEvent)=>{
        if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes((e.target as HTMLElement)?.tagName)||session.state.dialogue||session.state.battle)return;
        const delta=({ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0}} as Record<string,Point>)[e.key];
        if(delta){e.preventDefault();const p=session.state.save.world;this.walk({x:p.x+delta.x,y:p.y+delta.y});}
      });
      this.events.once('shutdown',()=>this.dispose());
      this.events.once('destroy',()=>this.dispose());
    }
    dispose(){this.disposed=true;this.off?.();this.off=undefined;this.routeVersion++;}
    private addLayer<T extends Phaser.GameObjects.GameObject>(o:T):T{this.layers.push(o);return o;}
    private label(x:number,y:number,text:string,color='#fff9ce',size=13){return this.addLayer(this.add.text(x,y,text,{fontFamily:'Georgia, serif',fontSize:size,color,stroke:'#283c57',strokeThickness:3,align:'center'}).setOrigin(.5).setDepth(900));}
    private clear(){this.routeVersion++;this.walking=false;this.tweens.killAll();this.layers.forEach(o=>o.destroy());this.layers=[];this.figures.clear();this.previousHP.clear();this.player=undefined;}
    sync(){
      if(this.disposed||!this.add)return;
      const s=session.state,b=s.battle,m=mapFor(s,session.campaign);
      const targets=visibleTargets(s,session.campaign);
      const key=b?'battle:'+b.id:JSON.stringify([m.id,targets.map(t=>t.id),currentStep(s,session.campaign)?.id,s.save.activePetIds,s.save.companionIds]);
      if(key!==this.worldKey){
        this.worldKey=key;this.clear();
        const bg=b?session.campaign.battles.find(x=>x.id===b.id)!.backgroundAssetId:m.backgroundAssetId;
        this.addLayer(this.add.image(480,270,bg).setDisplaySize(960,540));
        if(b){
          const enemies=b.units.filter(u=>u.side==='ENEMY'),allies=b.units.filter(u=>u.side==='ALLY');
          b.units.forEach(u=>{
            const team=u.side==='ENEMY'?enemies:allies,i=team.indexOf(u);
            const x=u.side==='ENEMY'?250+(i%2)*70:595+(i%2)*90,y=200+i*55;
            this.addLayer(this.add.ellipse(x,y+8,70,20,0x233e56,.25));
            const image=this.addLayer(this.add.image(x,y,u.assetId).setOrigin(.5,1).setDisplaySize(u.role==='PET'?64:82,u.role==='PET'?76:110));
            this.figures.set(u.id,image);this.label(x,y+30,u.name);
          });
        }else{
          const floor=this.addLayer(this.add.graphics());
          const outdoor=['GROUNDS','FOREST','VILLAGE'].includes(m.theme);
          for(let x=1;x<m.width-1;x++)for(let y=1;y<m.height-1;y++){
            if(m.blocked.some(p=>p.x===x&&p.y===y))continue;
            const p=iso({x,y}),dark=(x+y)%2===0;
            floor.fillStyle(outdoor?(dark?0xafbe8c:0xb8c79c):(dark?0xd1c9ae:0xe1d9c0),.88);
            floor.fillPoints([{x:p.x,y:p.y-12},{x:p.x+24,y:p.y},{x:p.x,y:p.y+12},{x:p.x-24,y:p.y}],true);
            floor.lineStyle(1,0x75856f,.1);floor.strokePoints([{x:p.x,y:p.y-12},{x:p.x+24,y:p.y},{x:p.x,y:p.y+12},{x:p.x-24,y:p.y}],true);
          }
          // The grid and architecture are original restoration geometry, not recovered maps.
          const edge=this.addLayer(this.add.graphics());edge.lineStyle(5,outdoor?0x698963:0x807d87,.8);
          const a=iso({x:1,y:1}),z=iso({x:16,y:1}),d=iso({x:1,y:12});edge.strokePoints([d,a,z]);
          for(const target of targets){
            const p=iso(target.position);let image:Phaser.GameObjects.Image|undefined;
            if(target.kind==='PORTAL'){
              const glow=this.addLayer(this.add.ellipse(p.x,p.y,45,23,0x4f91c5,.75).setStrokeStyle(2,0xeef9ff));
              glow.setInteractive({useHandCursor:true}).on('pointerdown',()=>this.approach(target.id));
              this.label(p.x,p.y+21,target.name,'#fff7d4',12);
            }else{
              const id=target.kind==='NPC'?session.campaign.actors.find(a=>a.id===target.id)!.spriteAssetId:target.kind==='OBJECT'?m.objects.find(o=>o.id===target.id)!.assetId:'icon.encounter';
              this.addLayer(this.add.ellipse(p.x,p.y,36,13,0x293c40,.2));
              image=this.addLayer(this.add.image(p.x,p.y,id).setOrigin(.5,1).setDisplaySize(target.kind==='NPC'?56:38,target.kind==='NPC'?76:42).setDepth(p.y));
              image.setInteractive({useHandCursor:true}).on('pointerdown',()=>this.approach(target.id));
              this.label(p.x,p.y+13,target.name);
            }
            if(currentStep(s,session.campaign)?.targetId===target.id)this.label(p.x,p.y-(target.kind==='NPC'?90:48),'!', '#fff29b',26);
          }
          const p=iso(s.save.world);this.player=this.addLayer(this.add.image(p.x,p.y,s.save.character.appearanceId).setOrigin(.5,1).setDisplaySize(59,79).setDepth(p.y+1));
          this.figures.set('player',this.player);
          const followers=[...s.save.activePetIds.map(id=>{const pet=s.save.pets.find(p=>p.id===id)!,def=session.campaign.pets.find(d=>d.id===pet.definitionId)!;return{id,asset:pet.level>=def.evolutionLevel?def.evolvedAssetId:def.spriteAssetId};}),...s.save.companionIds.map(id=>({id,asset:session.campaign.actors.find(a=>a.id===id)!.spriteAssetId}))];
          followers.forEach((f,i)=>{const image=this.addLayer(this.add.image(p.x-34-i*23,p.y+10+i*3,f.asset).setOrigin(.5,1).setDisplaySize(i<2?38:46,i<2?45:63).setDepth(p.y+12+i));this.figures.set(f.id,image);});
        }
      }
      if(b){for(const u of b.units){const f=this.figures.get(u.id);f?.setAlpha(u.hp?1:.25);if(f){
        f.setTint(u.gauge===100&&u.hp?0xffefb0:0xffffff);
        const old=this.previousHP.get(u.id);if(old!==undefined&&old!==u.hp){
          const text=this.label(f.x,f.y-95,(u.hp>old?'+':'')+(u.hp-old),u.hp>old?'#baffae':'#ffe4c5',24);
          this.tweens.add({targets:text,y:text.y-30,alpha:0,duration:700,onComplete:()=>text.destroy()});
          if(u.hp<old)this.tweens.add({targets:f,alpha:.45,duration:85,yoyo:true,repeat:1});
        }
        this.previousHP.set(u.id,u.hp);
      }}}
      else if(!this.walking&&this.player){const p=iso(s.save.world);this.player.setPosition(p.x,p.y).setDepth(p.y+1);}
    }
    approach(id:string){
      if(this.disposed)return;
      const target=visibleTargets(session.state,session.campaign).find(t=>t.id===id);if(!target)return;
      const m=mapFor(session.state,session.campaign),start=session.state.save.world,p=target.position;
      const routes=[{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}].map(end=>findPath(m,start,end)).filter((r):r is Point[]=>!!r).sort((a,b)=>a.length-b.length);
      if(!routes[0])return;this.walk(routes[0].at(-1)!,{type:'INTERACT',targetId:id});
    }
    private walk(end:Point,then?:Command){
      if(session.busy||session.state.dialogue||session.state.battle||!this.player)return;
      const path=findPath(mapFor(session.state,session.campaign),session.state.save.world,end);if(!path)return;
      this.routeVersion++;const version=this.routeVersion;this.tweens.killAll();this.walking=true;
      const move=(i:number)=>{
        if(version!==this.routeVersion)return;
        if(i>=path.length){this.walking=false;if(then)void session.dispatch(then).catch(e=>onError(String(e.message)));return;}
        const tile=path[i]!,p=iso(tile),old=iso(session.state.save.world);
        this.player!.setDepth(p.y+1);
        this.figures.forEach((f,id)=>{if(id!=='player'){this.tweens.add({targets:f,x:f.x+p.x-old.x,y:f.y+p.y-old.y,duration:145});f.setDepth(p.y+14);}});
        this.tweens.add({targets:this.player,x:p.x,y:p.y,duration:145,onComplete:()=>{
          if(!session.moveTo(tile)){this.walking=false;this.sync();return;}move(i+1);
        }});
      };move(1);
    }
  }
  const game=new Phaser.Game({type:Phaser.AUTO,parent,width:960,height:540,transparent:false,antialias:true,scene:SchoolScene,audio:{noAudio:true},banner:false,scale:{mode:Phaser.Scale.NONE},render:{roundPixels:true}});
  return {destroy(){scene?.dispose();scene=undefined;game.destroy(true);},approach(id){scene?.approach(id);}};
}
