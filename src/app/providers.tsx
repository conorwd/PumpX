'use client';

import { ReactNode } from 'react';
import { TradingProvider } from '../contexts/TradingContext';
import { BlacklistProvider } from '../contexts/BlacklistContext';
import { BuylistProvider } from '../contexts/BuylistContext';
import { WalletProvider } from '../contexts/WalletContext';
import { Toaster } from 'react-hot-toast';

export default function Providers({
  children,
}: {
  children: ReactNode;
}) {
  return (
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
  );
}
