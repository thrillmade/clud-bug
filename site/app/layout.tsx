import type { Metadata } from 'next';
import { Fraunces, EB_Garamond, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  axes: ['opsz', 'SOFT', 'WONK'],
  display: 'swap',
});

const ebGaramond = EB_Garamond({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://cludbug.dev'),
  title: 'Clud Bug — AI PR review with project-aware skills',
  description:
    'Install the Clud Bug GitHub App. PR reviews graded against your team’s own skills — your conventions, your API contracts, your compliance rules. Reviews land within two minutes. Self-hosted workflow also available.',
  openGraph: {
    title: 'Clud Bug — AI PR review with project-aware skills',
    description:
      'Install the GitHub App. Reviews land on every PR within two minutes, cited against the skills your team writes. Multi-pass review on the Team tier. Self-hosted workflow optional.',
    url: 'https://cludbug.dev',
    siteName: 'Clud Bug',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clud Bug — AI PR review with project-aware skills',
    description:
      'Install the GitHub App. Reviews land on every PR within two minutes, cited against the skills your team writes. Self-hosted workflow optional.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${ebGaramond.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
