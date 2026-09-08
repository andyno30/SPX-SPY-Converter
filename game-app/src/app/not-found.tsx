import Link from 'next/link';

export default function NotFound() {
  return <main><p className="eyebrow">Magic School Arpia</p><h1>Page not found.</h1><nav><Link href="/" prefetch={false}>Back to Arpia</Link></nav></main>;
}
