import { TradingProvider } from '../context/TradingContext';
import { BlacklistProvider } from '../context/BlacklistContext';
import { BuylistProvider } from '../context/BuylistContext';
import '../styles/globals.css';
import { Inter } from 'next/font/google';
import { Toaster } from 'react-hot-toast';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'Pump Fun Bot',
  description: 'Automated trading bot for Solana',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <TradingProvider>
          <BlacklistProvider>
            <BuylistProvider>
              {children}
              <Toaster position="bottom-right" />
            </BuylistProvider>
          </BlacklistProvider>
        </TradingProvider>
      </body>
    </html>
  );
}
