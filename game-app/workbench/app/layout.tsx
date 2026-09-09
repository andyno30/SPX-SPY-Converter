import type {ReactNode} from 'react';
import '../../src/ui/arpia.css';
export const metadata={title:'Arpia — Local Playtest',robots:{index:false,follow:false}};
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>;}
