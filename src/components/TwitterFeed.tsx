"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { TwitterService } from '../services/twitterService';
import { Connection, Keypair } from '@solana/web3.js';
import { PumpFunClient } from '../pumpFunClient';
import { useTradingContext } from '../context/TradingContext';
import { useBlacklist } from '../context/BlacklistContext';
import { useBuylist } from '../context/BuylistContext';
import { TokenInfo } from '../types';
import bs58 from 'bs58';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { OrderStatus } from '../context/TradingContext';

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
  const [lastTweetId, setLastTweetId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [purchasedMints, setPurchasedMints] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pumpfun_purchased_mints');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    }
    return new Set();
  });
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const priceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const twitterService = useRef(new TwitterService()).current;

  const handleBuy = async (tweet: Tweet) => {
    if (!pumpFunClient || !tweet.mintAddress) return;
    
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

      const signature = await pumpFunClient.buy(tweet.mintAddress, buyAmount, slippage);
      
      if (signature) {
        setTxSignatures(prev => ({ ...prev, [tweet.id_str]: signature }));
        addToPurchasedMints(tweet.mintAddress);
        
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
      
      // Parse the error message from the RPC response
      if (error.response?.data?.result?.value?.err) {
        errorMessage = error.response.data.result.value.err;
      } else if (error.message) {
        errorMessage = error.message;
      }

      // Update the pending order with error if it exists
      if (pendingOrder) {
        updateOrder(pendingOrder.id, {
          status: 'error',
          error: errorMessage
        });

        // Remove failed order after 15 seconds
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
    if (!pumpFunClient || !tweet.mintAddress) return;
    
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

      const signature = await pumpFunClient.buy(tweet.mintAddress, buyAmount, slippage);
      
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
      
      // Parse the error message from the RPC response
      if (error.response?.data?.result?.value?.err) {
        errorMessage = error.response.data.result.value.err;
      } else if (error.message) {
        errorMessage = error.message;
      }

      // Update the pending order with error if it exists
      if (pendingOrder) {
        updateOrder(pendingOrder.id, {
          status: 'error',
          error: errorMessage
        });

        // Remove failed order after 15 seconds
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
    const autoBuyAttempted = localStorage.getItem(autoBuyKey);
    
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
      pumpFunClient &&
      !purchasedMints.has(tweet.mintAddress) &&
      !autoBuyAttempted &&
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
  }, [autoBuyEnabled, minFollowers, followerCheckEnabled, txSignatures, buyLoading, privateKey, pumpFunClient, isBlacklisted, purchasedMints, isBuylisted]);

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
      const url = `/api/pump-proxy?mintAddress=${mintAddress}`;
      const response = await fetch(url, {
        headers: {
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.5"
        }
      });

      if (response.status === 200) {
        const data = await response.json();
        // Use current timestamp if the API doesn't provide one or if it's invalid
        const now = Math.floor(Date.now() / 1000);
        const createdTimestamp = data.created_timestamp && data.created_timestamp > 1577836800 ? data.created_timestamp : now;
        
        return {
          symbol: data.symbol || '???',
          name: data.name || 'Unknown Token',
          imageUrl: data.image_uri || '',
          price: data.market_cap / (data.total_supply / 1e9), // Calculate price from market cap
          marketCap: data.usd_market_cap,
          createdTimestamp: createdTimestamp
        };
      }
      console.error('Error fetching token info:', response.status);
      return undefined;
    } catch (error) {
      console.error('Error fetching token info:', error);
      return undefined;
    }
  };

  const fetchTweets = async () => {
    if (isPaused || loading) return; // Prevent concurrent fetches
    
    try {
      setLoading(true);
      setError(null);
      const query = encodeURIComponent('pump.fun/ -filter:retweets');
      const type = 'Latest';
      
      // Use since_id to only get tweets newer than our last seen tweet
      const sinceIdParam = lastTweetId ? `+since_id:${lastTweetId}` : '';
      const response = await fetch(`/api/twitter-proxy?query=${query}${sinceIdParam}&type=${type}`);
      
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
      
      if (data.tweets.length === 0) {
        setLoading(false);
        return;
      }

      // Sort tweets by ID in descending order (newest first)
      const sortedTweets = [...data.tweets].sort((a, b) => b.id_str.localeCompare(a.id_str));
      
      // Update last tweet ID before processing to prevent race conditions
      const newestTweetId = sortedTweets[0].id_str;
      setLastTweetId(newestTweetId);
      
      // Fetch token info for new tweets
      const enrichedNewTweets = await Promise.all(
        sortedTweets.map(async (tweet: Tweet) => {
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

      // Add new tweets to the existing list, ensuring no duplicates
      setTweets(prevTweets => {
        // Create a Set of existing tweet IDs for O(1) lookup
        const existingIds = new Set(prevTweets.map(t => t.id_str));
        
        // Only add tweets that don't already exist
        const uniqueNewTweets = enrichedNewTweets.filter(tweet => !existingIds.has(tweet.id_str));
        
        const allTweets = [...uniqueNewTweets, ...prevTweets]
          .sort((a, b) => b.id_str.localeCompare(a.id_str)) // Sort by ID (most recent first)
          .slice(0, 100); // Keep only the 100 most recent tweets
          
        return allTweets;
      });
      
    } catch (err) {
      console.error('Error fetching tweets:', err);
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

    // Sort tweets by creation time before updating state
    setTweets(
      updatedTweets
        .sort((a, b) => b.id_str.localeCompare(a.id_str)) // Sort by ID (most recent first)
        .slice(0, 100)
    );
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

  const getPumpFunUrl = (tweet: Tweet): string => {
    if (!tweet.mintAddress) return 'https://pump.fun';
    return `https://pump.fun/coin/${tweet.mintAddress}`;
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
            {tweets
              .filter(tweet => !isBlacklisted(tweet.user.screen_name))
              .map((tweet) => (
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
                        {formatTweetTime(tweet.tweet_created_at)}
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
                          <span className="text-yellow-400">
                            {formatCreationTime(tweet.tokenInfo.createdTimestamp)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col space-y-2 ml-2">
                      <a
                        href={getPumpFunUrl(tweet)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 text-xs bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 rounded-lg border border-yellow-500/20 transition-colors whitespace-nowrap"
                      >
                        View on Pump.fun
                      </a>
                      <button
                        onClick={() => addToBlacklist(tweet.user.screen_name)}
                        className="px-3 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg border border-red-500/20 transition-colors whitespace-nowrap"
                      >
                        Blacklist User
                      </button>
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
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
