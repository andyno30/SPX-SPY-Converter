import Link from 'next/link';

export default function ProjectStatus() {
  return <main>
    <p className="eyebrow">Magic School Arpia</p>
    <h1>Work in progress.</h1>
    <p className="intro">The research is taking shape.</p>
    <p>The main mission catalog and an initial Free Mission catalog are documented. We’re still reconstructing playable quests, maps, and original replacement artwork.</p>
    <p>Accounts, cloud saves, and public gameplay are not available yet.</p>
    <nav><Link href="/" prefetch={false}>← Back to Arpia</Link></nav>
  </main>;
}
