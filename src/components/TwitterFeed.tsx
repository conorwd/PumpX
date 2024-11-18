"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { TwitterService } from '../services/twitterService';
import { Connection, Keypair } from '@solana/web3.js';
import { PumpFunClient } from '../pumpFunClient';
import { DexscreenerClient } from '../dexscreenerClient';
import { useTradingContext } from '../context/TradingContext';
import { useBlacklist } from '../context/BlacklistContext';
import { useBuylist } from '../context/BuylistContext';
import { TokenInfo } from '../types';
import bs58 from 'bs58';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { OrderStatus } from '../context/TradingContext';
import { RPC_ENDPOINT } from '../constants';
import { HeliusService } from '../services/heliusService';

interface Tweet {
  id_str: string;
  full_text: string;
  tweet_created_at: string;
  user: {
    name: string;
    screen_name: string;
    profile_image_url_https: string;
    followers_count: number;
  };
  entities: {
    urls: {
      expanded_url: string;
    }[];
  };
  source_type: 'pumpfun' | 'dexscreener';
  tokenInfo?: TokenInfo;
  mintAddress?: string;
  pricePerToken?: number;
  lastPriceCheck?: number;
}

declare global {
  interface Window {
    triggerTokenUpdate?: () => void;
  }
}

export default function TwitterFeed() {
  const {
    privateKey,
    buyAmount,
    autoBuyEnabled,
    minFollowers,
    followerCheckEnabled,
    slippage,
    addOrder,
    updateOrder,
    orders,
  } = useTradingContext();

  const { blacklistedUsers, addToBlacklist, isBlacklisted } = useBlacklist();
  const { isBuylisted } = useBuylist();
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [expandedTweets, setExpandedTweets] = useState<Set<string>>(new Set());
  const [refreshRate, setRefreshRate] = useState(() => {
    if (typeof window !== 'undefined') {
      return Number(localStorage.getItem('twitterRefreshRate')) || 10;
    }
    return 10;
  });
  const [buyLoading, setBuyLoading] = useState<{ [key: string]: boolean }>({});
  const [txSignatures, setTxSignatures] = useState<{ [key: string]: string }>({});
  const [pumpFunClient, setPumpFunClient] = useState<PumpFunClient | null>(null);
  const [dexscreenerClient, setDexscreenerClient] = useState<DexscreenerClient | null>(null);
  const [lastTweetId, setLastTweetId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [purchasedMints, setPurchasedMints] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pumpfun_purchased_mints');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    }
    return new Set();
  });
  const [activeSourceTypes, setActiveSourceTypes] = useState<Set<string>>(
    new Set(['pumpfun', 'dexscreener'])
  );

  const sourceTypes = [
    { 
      type: 'pumpfun', 
      label: 'Pump.fun', 
      activeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      dotClass: 'bg-blue-500'
    },
    { 
      type: 'dexscreener', 
      label: 'DexScreener', 
      activeClass: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      dotClass: 'bg-green-500'
    }
  ];

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const priceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const twitterService = useRef(new TwitterService()).current;

  const handleBuy = async (tweet: Tweet) => {
    if (!tweet.mintAddress) return;
    
    const client = tweet.source_type === 'pumpfun' ? pumpFunClient : dexscreenerClient;
    if (!client) return;
    
    let pendingOrder: OrderStatus | undefined;
    
    try {
      setBuyLoading(prev => ({ ...prev, [tweet.id_str]: true }));

      // Create initial order with pending status
      const newOrder: Omit<OrderStatus, 'id' | 'timestamp'> = {
        tokenSymbol: tweet.tokenInfo?.symbol || '???',
        tokenName: tweet.tokenInfo?.name || 'Unknown Token',
        type: 'buy' as const,
        amount: buyAmount,
        status: 'pending' as const,
        mintAddress: tweet.mintAddress
      };
      
      // Add the order and get its ID
      pendingOrder = addOrder(newOrder);

      let signature: string | undefined;
      if (tweet.source_type === 'pumpfun' && tweet.mintAddress) {  
        const result = await pumpFunClient!.buy(tweet.mintAddress, buyAmount, slippage);
        signature = result ?? undefined;
      } else if (tweet.mintAddress) {  
        const result = await dexscreenerClient!.buyToken(tweet.mintAddress, buyAmount, slippage * 100);
        if (!result.success) {
          throw new Error(result.error);
        }
        signature = result.signature ?? undefined;
      } else {
        throw new Error('No mint address found for token');
      }
      
      if (signature) {  
        setTxSignatures(prev => ({ ...prev, [tweet.id_str]: signature }));
        
        // Update order status to success immediately
        if (pendingOrder) {
          updateOrder(pendingOrder.id, {
            status: 'success',
            signature
          });

          // Remove successful order after 15 seconds
          setTimeout(() => {
            if (pendingOrder) {
              updateOrder(pendingOrder.id, { status: 'success', error: 'removed' });
            }
          }, 15000);
        }
      } else {
        throw new Error('Transaction failed');
      }
    } catch (error: any) {
      console.error('Buy error:', error);
      let errorMessage = 'Transaction failed';
      
      if (error.response?.data?.result?.value?.err) {
        errorMessage = error.response.data.result.value.err;
      } else if (error.message) {
        errorMessage = error.message;
      }

      if (pendingOrder) {
        updateOrder(pendingOrder.id, {
          status: 'error',
          error: errorMessage
        });

        setTimeout(() => {
          if (pendingOrder) {
            updateOrder(pendingOrder.id, { status: 'error', error: 'removed' });
          }
        }, 15000);
      }
    } finally {
      setBuyLoading(prev => ({ ...prev, [tweet.id_str]: false }));
    }
  };

  const handleAutoBuy = async (tweet: Tweet) => {
    if (!tweet.mintAddress) return;
    
    const autoBuyKey = `autobuy_${tweet.id_str}`;
    
    // Check if we've already tried to autobuy this tweet
    const autoBuyAttempted = localStorage.getItem(autoBuyKey);
    if (autoBuyAttempted) return;
    
    let pendingOrder: OrderStatus | undefined;
    
    try {
      setBuyLoading(prev => ({ ...prev, [tweet.id_str]: true }));

      // Create initial order with pending status
      const newOrder: Omit<OrderStatus, 'id' | 'timestamp'> = {
        tokenSymbol: tweet.tokenInfo?.symbol || '???',
        tokenName: tweet.tokenInfo?.name || 'Unknown Token',
        type: 'buy' as const,
        amount: buyAmount,
        status: 'pending' as const,
        mintAddress: tweet.mintAddress
      };
      
      // Add the order and get its ID
      pendingOrder = addOrder(newOrder);

      const client = tweet.source_type === 'pumpfun' ? pumpFunClient : dexscreenerClient;
      if (!client) return;

      let signature: string | undefined;
      if (tweet.source_type === 'pumpfun' && tweet.mintAddress) {  
        const result = await pumpFunClient!.buy(tweet.mintAddress, buyAmount, slippage);
        signature = result ?? undefined;
      } else if (tweet.mintAddress) {  
        const result = await dexscreenerClient!.buyToken(tweet.mintAddress, buyAmount, slippage * 100);
        if (!result.success) {
          throw new Error(result.error);
        }
        signature = result.signature ?? undefined;
      } else {
        throw new Error('No mint address found for token');
      }
      
      if (signature) {  
        setTxSignatures(prev => ({ ...prev, [tweet.id_str]: signature }));
        
        // Update order status to success immediately
        if (pendingOrder) {
          updateOrder(pendingOrder.id, {
            status: 'success',
            signature
          });

          // Remove successful order after 15 seconds
          setTimeout(() => {
            if (pendingOrder) {
              updateOrder(pendingOrder.id, { status: 'success', error: 'removed' });
            }
          }, 15000);
        }
      } else {
        throw new Error('Transaction failed');
      }
    } catch (error: any) {
      console.error('Autobuy error:', error);
      let errorMessage = 'Transaction failed';
      
      if (error.response?.data?.result?.value?.err) {
        errorMessage = error.response.data.result.value.err;
      } else if (error.message) {
        errorMessage = error.message;
      }

      if (pendingOrder) {
        updateOrder(pendingOrder.id, {
          status: 'error',
          error: errorMessage
        });

        setTimeout(() => {
          if (pendingOrder) {
            updateOrder(pendingOrder.id, { status: 'error', error: 'removed' });
          }
        }, 15000);
      }
    } finally {
      setBuyLoading(prev => ({ ...prev, [tweet.id_str]: false }));
      // Mark this tweet as attempted for autobuy
      localStorage.setItem(autoBuyKey, 'true');
    }
  };

  const checkAndAutoBuy = useCallback((tweet: Tweet) => {
    // Check if we've already tried to autobuy this tweet
    const autoBuyKey = `autobuy_${tweet.id_str}`;
    
    const userIsBuylisted = isBuylisted(tweet.user.screen_name);
    const userIsBlacklisted = isBlacklisted(tweet.user.screen_name);
    const meetsFollowerRequirement = tweet.user.followers_count >= minFollowers;
    
    // Determine if we should buy based on user lists and settings
    const shouldBuyBasedOnUser = 
      // Always buy from buylisted users (unless blacklisted)
      (userIsBuylisted && !userIsBlacklisted) ||
      // For non-buylisted users, only buy if follower check is enabled AND they meet the requirement
      (!userIsBuylisted && !userIsBlacklisted && followerCheckEnabled && meetsFollowerRequirement);

    // Check all other conditions
    const shouldBuy = 
      autoBuyEnabled &&
      tweet.mintAddress &&
      tweet.tokenInfo &&
      !txSignatures[tweet.id_str] &&
      !buyLoading[tweet.id_str] &&
      privateKey &&
      (tweet.source_type === 'pumpfun' ? pumpFunClient : dexscreenerClient) &&
      !purchasedMints.has(tweet.mintAddress) &&
      !localStorage.getItem(autoBuyKey) &&
      shouldBuyBasedOnUser;

    if (shouldBuy) {
      // Determine the reason for buying
      const buyReason = userIsBuylisted 
        ? 'User is buylisted' 
        : 'Meets follower requirement';

      console.log('Auto-buying token from tweet:', {
        tweetId: tweet.id_str,
        user: tweet.user.screen_name,
        followers: tweet.user.followers_count,
        mintAddress: tweet.mintAddress,
        tokenSymbol: tweet.tokenInfo?.symbol || 'Unknown',
        isBuylisted: userIsBuylisted,
        followerCheckEnabled,
        minFollowers: followerCheckEnabled ? minFollowers : 'disabled',
        buyReason
      });
      handleAutoBuy(tweet);
    }
  }, [autoBuyEnabled, minFollowers, followerCheckEnabled, txSignatures, buyLoading, privateKey, pumpFunClient, dexscreenerClient, isBlacklisted, purchasedMints, isBuylisted]);

  useEffect(() => {
    if (autoBuyEnabled && tweets.length > 0) {
      tweets.forEach(tweet => {
        checkAndAutoBuy(tweet);
      });
    }
  }, [tweets, autoBuyEnabled, checkAndAutoBuy]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('pumpfun_purchased_mints', JSON.stringify([...purchasedMints]));
    }
  }, [purchasedMints]);

  const addToPurchasedMints = useCallback((mintAddress: string) => {
    setPurchasedMints(prev => new Set([...prev, mintAddress]));
  }, []);

  const handleRefreshRateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRate = Number(e.target.value);
    setRefreshRate(newRate);
    localStorage.setItem('twitterRefreshRate', newRate.toString());
    
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    if (!isPaused) {
      intervalRef.current = setInterval(fetchTweets, newRate * 1000);
    }
  };

  const toggleTweetExpansion = (tweetId: string) => {
    setExpandedTweets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tweetId)) {
        newSet.delete(tweetId);
      } else {
        newSet.add(tweetId);
      }
      return newSet;
    });
  };

  const truncateText = (text: string, maxLength: number = 120) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  };

  const formatFollowerCount = (count: number): string => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const formatMarketCap = (marketCap: number): string => {
    const roundedMarketCap = Math.round(marketCap);
    
    if (roundedMarketCap >= 1000000000) {
      return `${(roundedMarketCap / 1000000000).toFixed(1)}B`;
    } else if (roundedMarketCap >= 1000000) {
      return `${(roundedMarketCap / 1000000).toFixed(1)}M`;
    } else if (roundedMarketCap >= 1000) {
      return `${(roundedMarketCap / 1000).toFixed(1)}K`;
    }
    return roundedMarketCap.toString();
  };

  const formatTweetTime = (timestamp: string) => {
    const seconds = Math.floor((currentTime - new Date(timestamp).getTime()) / 1000);
    
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes}m`;
    } else if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours}h`;
    } else {
      const days = Math.floor(seconds / 86400);
      return `${days}d`;
    }
  };

  const formatCreationTime = (timestamp: number) => {
    // Handle both milliseconds and seconds timestamps
    const date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
    if (isNaN(date.getTime()) || date.getFullYear() < 2020) {
      return 'Recently';
    }
    return formatDistanceToNow(date, { addSuffix: true });
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const fetchTokenInfo = async (idOrAddress: string, source_type: 'pumpfun' | 'dexscreener'): Promise<TokenInfo | undefined> => {
    try {
      console.log(`Fetching token info for ${idOrAddress} with source type: ${source_type}`);
      
      // For pump.fun tokens, use the existing proxy
      if (source_type === 'pumpfun') {
        console.log('Using pump-proxy for Pump.fun token');
        const url = `/api/pump-proxy?mintAddress=${idOrAddress}`;
        const response = await fetch(url, {
          headers: {
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.5"
          }
        });

        if (response.status === 200) {
          const data = await response.json();
          const now = Math.floor(Date.now() / 1000);
          const createdTimestamp = data.created_timestamp && data.created_timestamp > 1577836800 ? data.created_timestamp : now;
          
          return {
            symbol: data.symbol || '???',
            name: data.name || 'Unknown Token',
            imageUrl: data.image_uri || '',
            price: data.market_cap / (data.total_supply / 1e9),
            marketCap: data.usd_market_cap,
            createdTimestamp: createdTimestamp
          };
        }
        return undefined;
      } 
      // For dexscreener tokens, get info directly from Dexscreener API
      else {
        console.log('Using Dexscreener API for pair ID:', idOrAddress);
        const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${idOrAddress}`);
        
        if (!response.ok) {
          throw new Error(`Dexscreener API error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!data.pair) {
          console.log('No pair data found in Dexscreener response');
          return undefined;
        }

        const { pair } = data;
        return {
          symbol: pair.baseToken.symbol || '???',
          name: pair.baseToken.name || 'Unknown Token',
          imageUrl: pair.info?.imageUrl || '',
          price: parseFloat(pair.priceUsd) || 0,
          marketCap: pair.marketCap || 0,
          createdTimestamp: Math.floor(pair.pairCreatedAt / 1000), // Convert from milliseconds to seconds
          mintAddress: pair.baseToken.address // Store the mint address for later use
        };
      }
    } catch (error) {
      console.error('Error fetching token info:', error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      return undefined;
    }
  };

  const updateTweetPrices = async () => {
    if (!pumpFunClient && !dexscreenerClient) return;

    const updatedTweets = await Promise.all(
      tweets.map(async tweet => {
        if (!tweet.mintAddress || (tweet.lastPriceCheck && Date.now() - tweet.lastPriceCheck < 30000)) {
          return tweet;
        }
        try {
          let price: number | undefined;
          if (tweet.source_type === 'pumpfun' && tweet.mintAddress) {
            const result = await pumpFunClient!.getTokenPrice(tweet.mintAddress);
            price = result ?? undefined;  // Convert null to undefined
          } else if (tweet.mintAddress) {
            const result = await dexscreenerClient!.getTokenPrice(tweet.mintAddress);
            price = result ?? undefined;  // Convert null to undefined
          }
          return {
            ...tweet,
            pricePerToken: price,
            lastPriceCheck: Date.now()
          } as Tweet;
        } catch (error) {
          console.error('Error fetching price for tweet:', error);
          return tweet;
        }
      })
    );

    // Sort tweets by creation time
    const sortedTweets = updatedTweets.sort((a, b) => 
      new Date(b.tweet_created_at).getTime() - new Date(a.tweet_created_at).getTime()
    );

    setTweets(sortedTweets);
  };

  const extractMintAddress = (tweet: Tweet): string | undefined => {
    const url = tweet.entities.urls[0]?.expanded_url;
    if (!url) return undefined;

    if (tweet.source_type === 'pumpfun') {
      const match = url.match(/pump\.fun\/coin\/([A-Za-z0-9]+)/);
      return match?.[1] ?? undefined;
    } else {
      // For dexscreener, extract the pair ID
      const match = url.match(/dexscreener\.com\/solana\/([A-Za-z0-9]+)/);
      return match?.[1] ?? undefined;
    }
  };

  const fetchTweets = async () => {
    if (isPaused) return;

    try {
      setLoading(true);
      const newTweets = await twitterService.searchTweets();

      // Process new tweets
      const processedTweets = await Promise.all(
        newTweets.map(async tweet => {
          const mintAddress = extractMintAddress(tweet);
          if (!mintAddress) return tweet;

          let tokenInfo: TokenInfo | undefined;
          try {
            // Pass the source_type to fetchTokenInfo
            tokenInfo = await fetchTokenInfo(mintAddress, tweet.source_type);
          } catch (error) {
            console.error('Error fetching token info:', error);
          }

          return {
            ...tweet,
            mintAddress,
            tokenInfo,
            lastPriceCheck: Date.now()
          };
        })
      );

      // Update state with new tweets
      setTweets(prevTweets => {
        // Create a map of existing tweets for deduplication
        const existingTweets = new Map(prevTweets.map(t => [t.id_str, t]));
        
        // Add new tweets to the map
        processedTweets.forEach(tweet => {
          existingTweets.set(tweet.id_str, tweet);
        });

        // Convert back to array and sort
        return Array.from(existingTweets.values())
          .sort((a, b) => new Date(b.tweet_created_at).getTime() - new Date(a.tweet_created_at).getTime());
      });

    } catch (error) {
      console.error('Error fetching tweets:', error);
      setError(error instanceof Error ? error.message : 'Error fetching tweets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initClients = async () => {
      try {
        if (!privateKey) {
          setPumpFunClient(null);
          setDexscreenerClient(null);
          return;
        }

        const decodedKey = bs58.decode(privateKey);
        const keypair = Keypair.fromSecretKey(decodedKey);
        const connection = new Connection(RPC_ENDPOINT, 'confirmed');
        
        // Initialize both clients
        const pumpClient = new PumpFunClient(connection, keypair);
        const dexClient = new DexscreenerClient(connection, keypair);
        
        setPumpFunClient(pumpClient);
        setDexscreenerClient(dexClient);
      } catch (err) {
        console.error('Error initializing clients:', err);
        setError('Failed to initialize trading clients');
        setPumpFunClient(null);
        setDexscreenerClient(null);
      }
    };

    initClients();
  }, [privateKey]);

  useEffect(() => {
    const fetchInitialTweets = async () => {
      try {
        setLoading(true);
        const newTweets = await twitterService.searchTweets();

        // Process new tweets
        const processedTweets = await Promise.all(
          newTweets.map(async tweet => {
            const mintAddress = extractMintAddress(tweet);
            if (!mintAddress) return tweet;

            let tokenInfo: TokenInfo | undefined;
            try {
              tokenInfo = await fetchTokenInfo(mintAddress, tweet.source_type);
            } catch (error) {
              console.error('Error fetching token info:', error);
            }

            return {
              ...tweet,
              mintAddress,
              tokenInfo
            } as Tweet;
          })
        );

        // Update state with new tweets
        setTweets(prevTweets => {
          // Create a map of existing tweets for deduplication
          const existingTweets = new Map(prevTweets.map(t => [t.id_str, t]));
          
          // Add new tweets to the map
          processedTweets.forEach(tweet => {
            existingTweets.set(tweet.id_str, tweet);
          });

          // Convert back to array and sort
          return Array.from(existingTweets.values())
            .sort((a, b) => new Date(b.tweet_created_at).getTime() - new Date(a.tweet_created_at).getTime());
        });

      } catch (err) {
        console.error('Failed to fetch initial tweets:', err);
        setError('Failed to fetch tweets');
      } finally {
        setLoading(false);
      }
    };

    fetchInitialTweets();
  }, []);

  useEffect(() => {
    fetchTweets();
    const tweetInterval = setInterval(fetchTweets, 10000);
    const priceInterval = setInterval(updateTweetPrices, 30000);

    return () => {
      clearInterval(tweetInterval);
      clearInterval(priceInterval);
    };
  }, [isPaused]);

  const getTweetUrl = (tweet: Tweet): string => {
    return `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`;
  };

  const getDexscreenerUrl = (tweet: Tweet): string => {
    if (!tweet.entities.urls.length) return 'https://dexscreener.com';
    const url = tweet.entities.urls[0].expanded_url;
    const [baseUrl, params] = url.split('?');
    return baseUrl;
  };

  const getPumpFunUrl = (tweet: Tweet): string => {
    if (!tweet.mintAddress) return 'https://pump.fun';
    return `https://pump.fun/coin/${tweet.mintAddress}`;
  };

  const toggleSourceType = (type: string) => {
    setActiveSourceTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  };

  const filteredTweets = tweets.filter(tweet => 
    activeSourceTypes.has(tweet.source_type)
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-3 py-1 rounded-md text-sm font-medium ${
              isPaused
                ? 'bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-400">Refresh:</span>
            <select
              value={refreshRate}
              onChange={handleRefreshRateChange}
              className="bg-gray-800 border border-gray-700 rounded-md text-sm px-2 py-1 text-gray-300"
            >
              <option value="5">5s</option>
              <option value="10">10s</option>
              <option value="30">30s</option>
              <option value="60">60s</option>
            </select>
          </div>
          <div className="flex items-center space-x-2 px-4 border-l border-gray-700">
            {sourceTypes.map(({ type, label, activeClass, dotClass }) => (
              <button
                key={type}
                onClick={() => toggleSourceType(type)}
                className={`
                  flex items-center px-2 py-1 rounded text-sm transition-all
                  ${activeSourceTypes.has(type)
                    ? activeClass
                    : 'bg-gray-700 text-gray-300 opacity-50 hover:opacity-80'
                  }
                `}
              >
                <div className={`w-2 h-2 rounded-full ${dotClass} mr-2`} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && tweets.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-b-blue-500"></div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-red-500 text-sm">{error}</div>
          </div>
        ) : tweets.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500 text-sm">No tweets found</div>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {filteredTweets
              .filter(tweet => !isBlacklisted(tweet.user.screen_name))
              .map((tweet) => (
              <div
                key={tweet.id_str}
                className={`bg-gray-900 rounded-lg shadow-lg border border-gray-700 p-3 hover:border-gray-600 transition-colors ${
                  tweet.source_type === 'pumpfun' 
                    ? 'border-l-4 border-blue-500'
                    : 'border-l-4 border-green-500'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <img
                      src={tweet.user.profile_image_url_https}
                      alt={tweet.user.name}
                      className="w-8 h-8 rounded-full"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-white text-sm truncate">
                          {tweet.user.name}
                        </span>
                        <span className="text-gray-400 text-xs">
                          @{tweet.user.screen_name}
                        </span>
                        <span className="text-gray-500 text-xs hidden sm:inline">·</span>
                        <span className="text-gray-400 text-xs hidden sm:inline">
                          {formatFollowerCount(tweet.user.followers_count)} followers
                        </span>
                        <span className="text-gray-500 text-xs hidden sm:inline">·</span>
                        <a
                          href={`https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-500 hover:text-gray-400 transition-colors hidden sm:inline"
                        >
                          <svg className="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </div>
                      <p className="mt-1 text-xs text-gray-300 break-words">
                        {tweet.full_text}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-xs text-gray-500">
                      {formatTweetTime(tweet.tweet_created_at)}
                    </span>
                    {tweet.mintAddress && (
                      <button
                        onClick={() => addToBlacklist(tweet.user.screen_name)}
                        className="text-gray-500 hover:text-gray-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col space-x-0 space-y-2">
                  {tweet.tokenInfo && (
                    <div className="flex justify-between items-start">
                      <div className="text-xs bg-gray-700/50 rounded p-2 space-y-1 flex-grow">
                        <div className="flex justify-between text-gray-400">
                          <span>Token:</span>
                          <span className="text-yellow-400">{tweet.tokenInfo.name}</span>
                        </div>
                        <div className="flex justify-between text-gray-400">
                          <span>Price:</span>
                          <span className="text-yellow-400">
                            ${tweet.pricePerToken?.toFixed(6) || tweet.tokenInfo?.price?.toFixed(6) || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between text-gray-400">
                          <span>Market Cap:</span>
                          <span className="text-yellow-400">
                            ${formatMarketCap(tweet.tokenInfo.marketCap || 0)}
                          </span>
                        </div>
                        {tweet.tokenInfo.createdTimestamp && (
                          <div className="flex justify-between text-gray-400">
                            <span>Created:</span>
                            <span className="text-yellow-400">
                              {formatCreationTime(tweet.tokenInfo.createdTimestamp)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-end space-x-2">
                    {tweet.source_type === 'pumpfun' ? (
                      <a
                        href={getPumpFunUrl(tweet)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 rounded-lg border border-blue-500/20 transition-colors whitespace-nowrap"
                      >
                        View on Pump.fun
                      </a>
                    ) : tweet.source_type === 'dexscreener' ? (
                      <a
                        href={getDexscreenerUrl(tweet)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 text-xs bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg border border-green-500/20 transition-colors whitespace-nowrap"
                      >
                        View on Dexscreener
                      </a>
                    ) : null}
                    {privateKey && (
                      <button
                        onClick={() => handleBuy(tweet)}
                        disabled={buyLoading[tweet.id_str] || !!txSignatures[tweet.id_str]}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors whitespace-nowrap ${
                          buyLoading[tweet.id_str]
                            ? 'bg-gray-500/10 text-gray-400 cursor-not-allowed border border-gray-500/20'
                            : txSignatures[tweet.id_str]
                            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                            : privateKey
                            ? 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 border border-yellow-500/20'
                            : 'bg-gray-500/10 text-gray-400 cursor-not-allowed border border-gray-500/20'
                        }`}
                      >
                        {buyLoading[tweet.id_str]
                          ? 'Buying...'
                          : txSignatures[tweet.id_str]
                          ? 'Bought'
                          : 'Buy'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
