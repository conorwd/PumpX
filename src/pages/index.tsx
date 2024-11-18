'use client';

import { useState, useEffect } from 'react';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { PumpFunClient } from '../pumpFunClient';
import TwitterFeed from '../components/TwitterFeed';
import Head from 'next/head';
import TradingSettings from '../components/TradingSettings';
import { TradingProvider } from '../context/TradingContext';
import Header from '../components/Header';
import Footer from '../components/Footer';

export default function Home() {
  const [privateKey, setPrivateKey] = useState(() => {
    // Initialize from localStorage if available
    if (typeof window !== 'undefined') {
      return localStorage.getItem('privateKey') || '';
    }
    return '';
  });
  const [mintAddress, setMintAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [txSignature, setTxSignature] = useState('');
  const [action, setAction] = useState<'buy' | 'sell'>('buy');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    // Initial check
    checkMobile();
    
    // Add event listener for window resize
    window.addEventListener('resize', checkMobile);
    
    // Cleanup
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Update localStorage when private key changes
  const handlePrivateKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setPrivateKey(newValue);
    localStorage.setItem('privateKey', newValue);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setTxSignature('');

    try {
      const decodedKey = bs58.decode(privateKey);
      const keypair = Keypair.fromSecretKey(decodedKey);
      
      const connection = new Connection(process.env.NEXT_PUBLIC_HELIUS_RPC_URL || '', 'confirmed');
      const client = new PumpFunClient(
        connection, 
        keypair,
        process.env.NEXT_PUBLIC_JITO_RPC_URL || 'https://jito-mainnet.rpcpool.com'
      );

      let signature: string | null = null;
      if (action === 'buy') {
        signature = await client.buy(mintAddress, parseFloat(amount), 25);
      } else {
        signature = await client.sell(mintAddress, parseFloat(amount), 25);
      }

      if (signature) {
        setTxSignature(signature);
      } else {
        setError('Transaction failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <TradingProvider>
      <div className="min-h-screen bg-gray-900 text-white pb-8">
        <Head>
          <title>Solana Pump Fun Twitter Bot</title>
          <meta name="description" content="Real-time Solana token tracking and trading" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <Header />
        <main className="container mx-auto px-4 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <TwitterFeed />
            </div>
            <div className="space-y-4">
              <TradingSettings isMobile={isMobile} />
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </TradingProvider>
  );
}
