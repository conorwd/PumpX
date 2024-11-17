"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { TwitterService } from '../services/twitterService';
import { Connection, Keypair } from '@solana/web3.js';
import { PumpFunClient } from '../pumpFunClient';
import { useTradingContext } from '../context/TradingContext';
import { TokenInfo } from '../types';
import bs58 from 'bs58';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';

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
    slippage,
    addOrder,
    updateOrder,
  } = useTradingContext();

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
  const [buyError, setBuyError] = useState<{ [key: string]: string | null }>({});
  const [txSignatures, setTxSignatures] = useState<{ [key: string]: string }>({});
  const [pumpFunClient, setPumpFunClient] = useState<PumpFunClient | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState(Date.now());
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const priceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const twitterService = useRef(new TwitterService()).current;

  const handleBuy = async (tweet: Tweet) => {
    if (!pumpFunClient || !tweet.mintAddress) return;
    
    try {
      setBuyLoading(prev => ({ ...prev, [tweet.id_str]: true }));
      setBuyError(prev => ({ ...prev, [tweet.id_str]: null }));
      
      // Add pending order first
      addOrder({
        tokenSymbol: tweet.tokenInfo?.symbol || '???',
        tokenName: tweet.tokenInfo?.name || 'Unknown Token',
        type: 'buy',
        amount: buyAmount,
        status: 'pending',
        mintAddress: tweet.mintAddress,
      });

      const signature = await pumpFunClient.buy(tweet.mintAddress, buyAmount, slippage);
      
      if (signature) {
        setTxSignatures(prev => ({ ...prev, [tweet.id_str]: signature }));
        
        // Update order status to success
        const orders = JSON.parse(localStorage.getItem('orders') || '[]');
        const pendingOrder = orders.find(
          (order: any) => 
            order.mintAddress === tweet.mintAddress && 
            order.status === 'pending'
        );
        
        if (pendingOrder) {
          updateOrder(pendingOrder.id, {
            status: 'success',
            signature
          });
        }
      } else {
        throw new Error('Transaction failed');
      }
    } catch (error) {
      console.error('Buy error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      setBuyError(prev => ({ ...prev, [tweet.id_str]: errorMessage }));
      
      // Update order status to error
      const orders = JSON.parse(localStorage.getItem('orders') || '[]');
      const pendingOrder = orders.find(
        (order: any) => 
          order.mintAddress === tweet.mintAddress && 
          order.status === 'pending'
      );
      
      if (pendingOrder) {
        updateOrder(pendingOrder.id, {
          status: 'error',
          error: errorMessage
        });
      }
    } finally {
      setBuyLoading(prev => ({ ...prev, [tweet.id_str]: false }));
    }
  };

  const checkAndAutoBuy = useCallback((tweet: Tweet) => {
    if (
      autoBuyEnabled &&
      tweet.mintAddress &&
      tweet.tokenInfo &&
      tweet.user.followers_count >= minFollowers &&
      !txSignatures[tweet.id_str] &&
      !buyLoading[tweet.id_str] &&
      !buyError[tweet.id_str] &&
      privateKey &&
      pumpFunClient
    ) {
      handleBuy(tweet);
    }
  }, [autoBuyEnabled, minFollowers, txSignatures, buyLoading, buyError, privateKey, pumpFunClient]);

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

  const formatTimeSinceCreation = (timestamp: number): string => {
    const now = Date.now();
    const diffInMinutes = Math.floor((now - timestamp) / (1000 * 60));
    
    if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`;
    } else {
      const hours = Math.floor(diffInMinutes / 60);
      return `${hours}h ago`;
    }
  };

  const updateTokenPrice = async (tweet: Tweet): Promise<Tweet> => {
    if (!tweet.mintAddress || !pumpFunClient) return tweet;

    // Only update price if it hasn't been checked in the last minute
    const now = Date.now();
    if (tweet.lastPriceCheck && now - tweet.lastPriceCheck < 60000) {
      return tweet;
    }

    try {
      const price = await pumpFunClient.getTokenPrice(tweet.mintAddress);
      return {
        ...tweet,
        pricePerToken: price || undefined,
        lastPriceCheck: now
      };
    } catch (error) {
      console.error(`Error updating price for ${tweet.mintAddress}:`, error);
      return {
        ...tweet,
        lastPriceCheck: now
      };
    }
  };

  const fetchTokenInfo = async (mintAddress: string): Promise<TokenInfo | undefined> => {
    try {
      const url = `https://frontend-api.pump.fun/coins/${mintAddress}`;
      const response = await axios.get(url, {
        headers: {
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.5"
        }
      });

      if (response.status === 200) {
        const data = response.data;
        return {
          symbol: data.symbol || '???',
          name: data.name || 'Unknown Token',
          imageUrl: data.image_uri || '',
          price: data.market_cap / (data.total_supply / 1e9), // Calculate price from market cap
          marketCap: data.usd_market_cap,
          createdTimestamp: data.created_timestamp
        };
      }
      return undefined;
    } catch (error) {
      console.error('Error fetching token info:', error);
      return undefined;
    }
  };

  const fetchTweets = async () => {
    if (isPaused) return;
    
    try {
      setLoading(true);
      setError(null);
      const query = encodeURIComponent('pump.fun/ -filter:retweets');
      const since_time = Math.floor(lastFetchTime / 1000);
      const type = 'Latest';
      
      const response = await fetch(`/api/twitter-proxy?query=${query}+since_time:${since_time}&type=${type}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Twitter API Error:', {
          status: response.status,
          data: errorData
        });
        throw new Error(errorData.error || `Failed to fetch tweets: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data || !data.tweets || !Array.isArray(data.tweets)) {
        console.error('Unexpected API response:', data);
        throw new Error('Invalid API response format');
      }
      
      // Process only new tweets
      const existingTweetIds = new Set(tweets.map(t => t.id_str));
      const brandNewTweets = data.tweets.filter((tweet: Tweet) => !existingTweetIds.has(tweet.id_str));
      
      // Fetch token info only for new tweets
      const enrichedNewTweets = await Promise.all(
        brandNewTweets.map(async (tweet: Tweet) => {
          const mintAddress = extractMintAddress(tweet);
          if (!mintAddress) return tweet;
          
          try {
            const tokenInfo = await fetchTokenInfo(mintAddress);
            const enrichedTweet: Tweet = {
              ...tweet,
              tokenInfo,
              mintAddress,
              lastPriceCheck: Date.now()
            };
            
            // Check for autobuy on new tweets
            checkAndAutoBuy(enrichedTweet);
            
            return enrichedTweet;
          } catch (error) {
            console.error('Error fetching token info:', error);
            return { ...tweet, mintAddress } as Tweet;
          }
        })
      );

      // Combine with existing tweets, keeping existing data for old tweets
      setTweets(prevTweets => {
        const allTweets = [...enrichedNewTweets, ...prevTweets]
          .sort((a, b) => new Date(b.tweet_created_at).getTime() - new Date(a.tweet_created_at).getTime())
          .slice(0, 10);
        return allTweets;
      });
      setLastFetchTime(Date.now());
    } catch (error) {
      console.error('Error fetching tweets:', error);
      setError('Failed to fetch tweets. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const updatePrices = async () => {
    if (!pumpFunClient || isPaused) return;

    const now = Date.now();
    const tweetsNeedingUpdate = tweets.filter(
      tweet => tweet.mintAddress && (!tweet.lastPriceCheck || now - tweet.lastPriceCheck >= 60000)
    );

    if (tweetsNeedingUpdate.length === 0) return;

    const updatedTweets = await Promise.all(
      tweets.map(async tweet => {
        if (!tweet.mintAddress || (tweet.lastPriceCheck && now - tweet.lastPriceCheck < 60000)) {
          return tweet;
        }
        return updateTokenPrice(tweet);
      })
    );
    setTweets(updatedTweets);
  };

  useEffect(() => {
    const initPumpFunClient = async () => {
      try {
        if (!privateKey) {
          setPumpFunClient(null);
          return;
        }

        const decodedKey = bs58.decode(privateKey);
        const keypair = Keypair.fromSecretKey(decodedKey);
        const connection = new Connection(process.env.NEXT_PUBLIC_HELIUS_RPC_URL || '', 'confirmed');
        const client = new PumpFunClient(connection, keypair);
        setPumpFunClient(client);
      } catch (err) {
        console.error('Error initializing PumpFunClient:', err);
        setError('Failed to initialize trading client');
        setPumpFunClient(null);
      }
    };

    initPumpFunClient();
  }, [privateKey]);

  useEffect(() => {
    const fetchInitialTweets = async () => {
      try {
        setLoading(true);
        setError(null);
        const query = encodeURIComponent('pump.fun/ -filter:retweets');
        const since_time = Math.floor(Date.now() / 1000);
        const type = 'Latest';
        
        const response = await fetch(`/api/twitter-proxy?query=${query}+since_time:${since_time}&type=${type}`);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch tweets: ${response.status}`);
        }

        const data = await response.json();
        
        // Process and enrich tweets
        const enrichedTweets = await Promise.all(
          data.tweets.map(async (tweet: Tweet) => {
            const mintAddress = extractMintAddress(tweet);
            if (!mintAddress) return tweet;
            
            try {
              const tokenInfo = await fetchTokenInfo(mintAddress);
              return { ...tweet, tokenInfo };
            } catch (err) {
              console.error(`Failed to fetch token info for ${mintAddress}:`, err);
              return tweet;
            }
          })
        );

        setTweets(enrichedTweets);
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
    const priceInterval = setInterval(updatePrices, 60000);

    return () => {
      clearInterval(tweetInterval);
      clearInterval(priceInterval);
    };
  }, [isPaused]);

  const extractMintAddress = (tweet: Tweet): string | null => {
    const pumpFunUrl = tweet.entities.urls.find(url => 
      url.expanded_url.includes('pump.fun/coin/')
    );
    
    if (!pumpFunUrl) return null;
    
    const match = pumpFunUrl.expanded_url.match(/pump\.fun\/coin\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  };

  const getTweetUrl = (tweet: Tweet): string => {
    return `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`;
  };

  const getPumpFunUrl = (tweet: Tweet): string | null => {
    const pumpFunUrl = tweet.entities.urls.find(url => 
      url.expanded_url.includes('pump.fun/coin/')
    );
    return pumpFunUrl ? pumpFunUrl.expanded_url : null;
  };

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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && tweets.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div>
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
            {tweets.map((tweet) => (
              <div key={`${tweet.id_str}-${tweet.user.screen_name}`} className="bg-gray-900 rounded-lg shadow-lg border border-gray-700 p-3 hover:border-gray-600 transition-colors">
                <div className="flex items-start space-x-3">
                  <img
                    src={tweet.user.profile_image_url_https}
                    alt={tweet.user.name}
                    className="w-10 h-10 rounded-full"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <div className="truncate flex items-center space-x-1">
                        <span className="text-xs font-bold text-gray-100">{tweet.user.name}</span>
                        <span className="text-xs text-gray-400">@{tweet.user.screen_name}</span>
                        <span className="text-xs text-gray-500">·</span>
                        <span className="text-xs text-gray-400">{formatFollowerCount(tweet.user.followers_count)} followers</span>
                        <span className="text-xs text-gray-500">·</span>
                        <a
                          href={getTweetUrl(tweet)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-yellow-500 hover:text-yellow-400"
                        >
                          View Tweet
                        </a>
                      </div>
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(new Date(tweet.tweet_created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <div className="mt-1">
                      <p className="text-xs text-gray-300">
                        {truncateText(tweet.full_text)}
                      </p>
                    </div>
                  </div>
                </div>
                {tweet.tokenInfo && (
                  <div className="mt-2 flex justify-between items-start">
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
                          <span className="text-yellow-400">{formatTimeSinceCreation(tweet.tokenInfo.createdTimestamp)}</span>
                        </div>
                      )}
                    </div>
                    
                    {tweet.mintAddress && (
                      <div className="flex flex-col items-end ml-3 min-w-[100px]">
                        <div className="flex items-center space-x-2">
                          {txSignatures[tweet.id_str] ? (
                            <a
                              href={`https://solscan.io/tx/${txSignatures[tweet.id_str]}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-green-400 hover:text-green-300"
                            >
                              View Transaction
                            </a>
                          ) : buyError[tweet.id_str] ? (
                            <span className="text-xs text-red-400">{buyError[tweet.id_str]}</span>
                          ) : (
                            <button
                              onClick={() => handleBuy(tweet)}
                              disabled={buyLoading[tweet.id_str] || !privateKey || !pumpFunClient}
                              className={`px-3 py-1 text-xs font-medium rounded-md ${
                                buyLoading[tweet.id_str]
                                  ? 'bg-yellow-500/50 cursor-not-allowed'
                                  : privateKey && pumpFunClient
                                  ? 'bg-yellow-500 hover:bg-yellow-400 text-gray-900'
                                  : 'bg-gray-700 cursor-not-allowed'
                              }`}
                            >
                              {buyLoading[tweet.id_str] ? 'Buying...' : 'Buy'}
                            </button>
                          )}
                        </div>
                        {getPumpFunUrl(tweet) && (
                          <a
                            href={getPumpFunUrl(tweet)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 mt-1"
                          >
                            View on Pump.fun
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
