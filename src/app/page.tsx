'use client';

import dynamic from 'next/dynamic';
import { TradingProvider } from '@/context/TradingContext';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import TradingSettings from '@/components/TradingSettings';
import TwitterFeed from '@/components/TwitterFeed';

export default function Home() {
  return (
    <TradingProvider>
      <div className="min-h-screen bg-gray-900 text-gray-100">
        <Header />
        
        <main className="container mx-auto px-4 py-6">
          <div className="grid grid-cols-12 gap-6">
            {/* Twitter Feed - Larger emphasis */}
            <div className="col-span-5 lg:col-span-6">
              <div className="bg-gray-900 rounded-lg border border-gray-800 h-[calc(100vh-12rem)] shadow-xl">
                <TwitterFeed />
              </div>
            </div>

            {/* Trading Settings - Compact version */}
            <div className="col-span-7 lg:col-span-6">
              <TradingSettings />
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </TradingProvider>
  );
}
