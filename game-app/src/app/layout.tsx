import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Arpia · SpyConverter Game',
  description: 'An English reconstruction of Magic School Arpia, in development.',
  robots: {index: false, follow: false},
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
