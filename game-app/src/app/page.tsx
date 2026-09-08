import Link from 'next/link';

export default function GameHome() {
  return <main>
    <p className="eyebrow">SpyConverter Game · In development</p>
    <h1>Magic School<br/><em>Arpia</em></h1>
    <p className="intro">A return to the school of magic.</p>
    <p>We’re reconstructing Arpia in English from surviving accounts of its world and adventures. The game is still in development and is not yet available to play.</p>
    <nav aria-label="Game navigation"><Link href="/status" prefetch={false}>Project status <span aria-hidden="true">→</span></Link></nav>
    <footer>An independent reconstruction project.</footer>
  </main>;
}
