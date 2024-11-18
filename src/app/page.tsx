'use client';

import dynamic from 'next/dynamic';
import { TradingProvider } from '@/context/TradingContext';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import TradingSettings from '@/components/TradingSettings';
import TwitterFeed from '@/components/TwitterFeed';
import { useState, useEffect } from 'react';

export default function Home() {
  const [isMobile, setIsMobile] = useState(false);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024); // 1024px is the lg breakpoint
    };

    // Set initial value
    handleResize();

    // Add event listener
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <TradingProvider>
      <div className="min-h-screen bg-gray-900 text-gray-100">
        <Header />
        
        <main className="container mx-auto px-4 py-6">
          {/* Mobile View */}
          <div className="lg:hidden flex flex-col space-y-4">
            <div className="h-[60vh] bg-gray-900 rounded-lg border border-gray-800 shadow-xl">
              <TwitterFeed />
            </div>
            <div className="bg-gray-900 rounded-lg border border-gray-800 shadow-xl">
              <TradingSettings isMobile={true} />
            </div>
          </div>

          {/* Desktop View - Preserved exactly as is */}
          <div className="hidden lg:grid grid-cols-12 gap-6">
            {/* Twitter Feed - Larger emphasis */}
            <div className="col-span-5 lg:col-span-6">
              <div className="bg-gray-900 rounded-lg border border-gray-800 h-[calc(100vh-12rem)] shadow-xl">
                <TwitterFeed />
              </div>
            </div>

            {/* Trading Settings - Compact version */}
            <div className="col-span-7 lg:col-span-6">
              <div className="bg-gray-900 rounded-lg border border-gray-800 h-[calc(100vh-12rem)] shadow-xl">
                <TradingSettings isMobile={false} />
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </TradingProvider>
  );
}
