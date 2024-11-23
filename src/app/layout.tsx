import { ReactNode } from 'react';
import { Metadata } from 'next';
import '../styles/globals.css';
import { Inter } from 'next/font/google';
import Providers from './providers';
import { Analytics } from "@vercel/analytics/react"

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SocialSnipe.Fun',
  description: 'Solana Social Based Token Sniper',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
