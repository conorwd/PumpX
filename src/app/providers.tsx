'use client';

import { ReactNode, useState, useEffect } from 'react';
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WalletProvider>
      <TradingProvider>
        <BlacklistProvider>
          <BuylistProvider>
            {mounted ? children : null}
            <Toaster position="bottom-right" />
          </BuylistProvider>
        </BlacklistProvider>
      </TradingProvider>
    </WalletProvider>
  );
}
