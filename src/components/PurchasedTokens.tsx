'use client';

import { useEffect, useState } from 'react';
import { useTradingContext } from '../context/TradingContext';
import bs58 from 'bs58';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import { PumpFunClient } from '../pumpFunClient';

// Extend Window interface for triggerTokenUpdate
declare global {
  interface Window {
    triggerTokenUpdate?: () => void;
  }
}

interface TokenHolding {
  mint: string;
  name: string;
  symbol: string;
  amount: number;
  decimals: number;
  pricePerToken?: number;
  totalValue?: number;
  isLoading?: boolean;
  sellAmount: number; // Changed to non-optional
  error?: string;
}

export default function PurchasedTokens() {
  const { privateKey, slippage } = useTradingContext();
  const [holdings, setHoldings] = useState<TokenHolding[]>([]);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPurchaseTime, setLastPurchaseTime] = useState<number | null>(null);
  const [pumpFunClient, setPumpFunClient] = useState<PumpFunClient | null>(null);

  const fetchSolBalance = async (publicKey: string) => {
    try {
      const connection = new Connection(process.env.NEXT_PUBLIC_HELIUS_RPC_URL || '');
      const balance = await connection.getBalance(new PublicKey(publicKey));
      setSolBalance(balance / LAMPORTS_PER_SOL);
    } catch (err) {
      console.error('Error fetching SOL balance:', err);
      setError('Failed to fetch SOL balance');
    }
  };

  const fetchTokenHoldings = async () => {
    if (!privateKey) return;

    try {
      setLoading(true);
      setError(null);

      const decodedKey = bs58.decode(privateKey);
      const publicKey = bs58.encode(decodedKey.slice(32));

      // Fetch SOL balance
      await fetchSolBalance(publicKey);

      const response = await fetch(process.env.NEXT_PUBLIC_HELIUS_RPC_URL || '', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'helius-test',
          method: 'searchAssets',
          params: {
            ownerAddress: publicKey,
            tokenType: "fungible"
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message);
      }

      // Filter and map tokens
      const pumpTokens = data.result.items
        .filter((asset: any) => {
          return asset.id.toLowerCase().endsWith('pump');
        })
        .map((asset: any) => ({
          mint: asset.id,
          name: asset.content?.metadata?.name || 'Unknown Token',
          symbol: asset.content?.metadata?.symbol || '???',
          amount: asset.token_info?.balance / Math.pow(10, asset.token_info?.decimals || 0),
          decimals: asset.token_info?.decimals || 0,
          pricePerToken: asset.token_info?.price_info?.price_per_token,
          totalValue: asset.token_info?.price_info?.total_price,
          sellAmount: 0 // Initialize with 0
        }));

      setHoldings(pumpTokens);
    } catch (err) {
      console.error('Error fetching token holdings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch token holdings');
    } finally {
      setLoading(false);
    }
  };

  const onTokenPurchase = () => {
    setLastPurchaseTime(Date.now());
    fetchTokenHoldings();
  };

  const handleSellAmountChange = (mint: string, amount: number) => {
    setHoldings(prev => prev.map(token => {
      if (token.mint !== mint) return token;
      
      // Validate the amount
      if (amount < 0) amount = 0;
      if (amount > token.amount) amount = token.amount;
      
      return { 
        ...token, 
        sellAmount: amount,
        error: undefined // Clear any previous error
      };
    }));
  };

  const handleSellToken = async (mint: string) => {
    if (!privateKey || !pumpFunClient) return;

    const token = holdings.find(t => t.mint === mint);
    if (!token) return;

    // Get the sell amount
    const sellAmount = token.sellAmount;
    if (sellAmount <= 0 || sellAmount > token.amount) {
      setHoldings(prev => prev.map(t => 
        t.mint === mint ? { ...t, error: `Invalid sell amount. Must be between 0 and ${token.amount}` } : t
      ));
      return;
    }

    // Calculate percentage of total balance
    const percentage = (sellAmount / token.amount) * 100;

    setHoldings(prev => prev.map(t => 
      t.mint === mint ? { ...t, isLoading: true, error: undefined } : t
    ));

    try {
      const signature = await pumpFunClient.sell(mint, percentage, slippage);
      if (signature) {
        console.log('Sell successful:', signature);
        // Reset sell amount after successful sale
        handleSellAmountChange(mint, 0);
        // Refresh holdings after successful sale
        await fetchTokenHoldings();
      }
    } catch (err) {
      console.error('Error selling token:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to sell token';
      setHoldings(prev => prev.map(t => 
        t.mint === mint ? { ...t, error: errorMessage } : t
      ));
    } finally {
      setHoldings(prev => prev.map(t => 
        t.mint === mint ? { ...t, isLoading: false } : t
      ));
    }
  };

  useEffect(() => {
    const initPumpFunClient = async () => {
      try {
        if (!privateKey || !process.env.NEXT_PUBLIC_HELIUS_RPC_URL) return;
        
        const connection = new Connection(process.env.NEXT_PUBLIC_HELIUS_RPC_URL);
        const decodedKey = bs58.decode(privateKey);
        const keypair = Keypair.fromSecretKey(decodedKey);
        const client = new PumpFunClient(connection, keypair);
        setPumpFunClient(client);
      } catch (err) {
        console.error('Error initializing PumpFunClient:', err);
        setError('Failed to initialize trading client');
      }
    };

    if (privateKey) {
      initPumpFunClient();
    }
  }, [privateKey]);

  useEffect(() => {
    const fetchTokenPrices = async () => {
      if (!pumpFunClient) return;

      const updatedHoldings = await Promise.all(
        holdings.map(async (token) => {
          if (token.pricePerToken) return token;

          try {
            const price = await pumpFunClient.getTokenPrice(token.mint);
            return {
              ...token,
              pricePerToken: price || undefined
            };
          } catch (err) {
            console.error(`Error fetching price for token ${token.mint}:`, err);
            return {
              ...token,
              error: 'Failed to fetch token price'
            };
          }
        })
      );

      setHoldings(updatedHoldings);
    };

    if (pumpFunClient && holdings.some(token => !token.pricePerToken)) {
      fetchTokenPrices();
    }
  }, [pumpFunClient, holdings]);

  // Initial fetch and polling setup
  useEffect(() => {
    if (!privateKey) return;

    // Initial fetch
    fetchTokenHoldings();

    // Set up polling every 10 seconds
    const intervalId = setInterval(fetchTokenHoldings, 10000);

    return () => {
      clearInterval(intervalId);
    };
  }, [privateKey]);

  // Listen for external updates
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.triggerTokenUpdate = onTokenPurchase;
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.triggerTokenUpdate = undefined;
      }
    };
  }, []);

  if (!privateKey) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p className="text-gray-400">Connect your wallet to view holdings</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-medium text-gray-200">Your Holdings</h3>
        <p className="text-xs text-gray-400">Balance: {solBalance.toFixed(4)} SOL</p>
      </div>

      {error && (
        <div className="mb-2 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {holdings.map((token) => (
          <div
            key={token.mint}
            className="p-3 bg-gray-900/50 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <h4 className="text-sm font-medium text-gray-200 truncate">{token.name}</h4>
                  <span className="text-xs text-gray-500">{token.symbol}</span>
                </div>
                <div className="flex items-center mt-0.5 space-x-2">
                  <p className="text-xs text-gray-400">{token.amount.toFixed(2)} tokens</p>
                  {token.pricePerToken && (
                    <>
                      <span className="text-xs text-gray-600">•</span>
                      <p className="text-xs text-gray-400">
                        ${(token.amount * token.pricePerToken).toFixed(2)}
                      </p>
                    </>
                  )}
                </div>
              </div>
              {token.isLoading && (
                <div className="text-xs text-yellow-500 animate-pulse">
                  Processing...
                </div>
              )}
            </div>

            {token.error && (
              <div className="mb-2 text-xs text-red-400">
                {token.error}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-1">
                <div className="flex gap-1">
                  {[25, 50, 75, 100].map((percent) => (
                    <button
                      key={percent}
                      onClick={() => handleSellAmountChange(token.mint, token.amount * (percent / 100))}
                      className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded transition-colors"
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => handleSellToken(token.mint)}
                  disabled={token.sellAmount <= 0 || token.isLoading}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    token.sellAmount <= 0 || token.isLoading
                      ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                      : 'bg-red-600 hover:bg-red-700 text-white'
                  }`}
                >
                  {token.isLoading ? 'Selling...' : 'Sell'}
                </button>
              </div>

              {token.sellAmount > 0 && (
                <div className="flex justify-between items-center text-xs text-gray-400 pt-1">
                  <span>
                    Selling: {((token.sellAmount / token.amount) * 100).toFixed(1)}%
                    {token.pricePerToken && (
                      <span className="ml-1">
                        (≈ ${(token.sellAmount * token.pricePerToken).toFixed(2)})
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {!loading && holdings.length === 0 && (
          <p className="text-center text-xs text-gray-400 py-6">No tokens found</p>
        )}

        {loading && (
          <div className="text-center py-6">
            <p className="text-xs text-gray-400">Loading holdings...</p>
          </div>
        )}
      </div>
    </div>
  );
}
