import {assertPackSelection} from '../src/game/engine/assets.js';
assertPackSelection(process.env.NEXT_PUBLIC_ASSET_PACK??'public',true);
console.log('Production asset selection: public');
