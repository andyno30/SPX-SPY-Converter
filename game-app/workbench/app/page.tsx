import {notFound} from 'next/navigation';
import Game from '../../src/ui/game';
import data from '../../content/adventure/opening.json';
import manifest from '../../public/assets/packs/public/manifest.json';
export default function Page(){
  if(process.env.NODE_ENV!=='development')notFound();
  return <Game data={data} manifest={manifest}/>;
}
