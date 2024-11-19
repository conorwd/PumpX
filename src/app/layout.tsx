'use client';

import { TradingProvider } from '../contexts/TradingContext';
import { BlacklistProvider } from '../contexts/BlacklistContext';
import { BuylistProvider } from '../contexts/BuylistContext';
import { WalletProvider } from '../contexts/WalletContext';
import '../styles/globals.css';
import { Inter } from 'next/font/google';
import { Toaster } from 'react-hot-toast';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WalletProvider>
          <TradingProvider>
            <BlacklistProvider>
              <BuylistProvider>
                {children}
                <Toaster position="bottom-right" />
              </BuylistProvider>
            </BlacklistProvider>
          </TradingProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
