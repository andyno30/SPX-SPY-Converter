import {checkContent} from './research/check-content.js';
const content=checkContent();
console.error('GAMEPLAY RELEASE BLOCKED');
console.error('Playable quests: '+content.main.filter(m=>m.milestones.playable).length+'; runtime maps: '+content.runtimeMapCount+'; approved assets: '+content.approvedAssets+'.');
console.error('Licensed runtime content, server-validated rewards and live Auth/two-user save verification are required before public play.');
process.exitCode=1;
