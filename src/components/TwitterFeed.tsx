"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { TwitterService } from '../services/twitterService';
import { Connection, Keypair } from '@solana/web3.js';
import { PumpFunClient } from '../pumpFunClient';
import { DexscreenerClient } from '../dexscreenerClient';
import { useTradingContext } from '../contexts/TradingContext';
import { useBlacklistContext } from '../contexts/BlacklistContext';
import { useBuylistContext } from '../contexts/BuylistContext';
import { Tweet as ImportedTweet, TokenInfo } from '../types';
import bs58 from 'bs58';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { OrderStatus } from '../contexts/TradingContext';
import { RPC_ENDPOINT } from '../constants';
import { HeliusService } from '../services/heliusService';

interface LocalTweet extends Omit<ImportedTweet, 'text'> {
  full_text: string;
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
    followerCheckEnabled,
    minFollowers,
    creationTimeEnabled,
    maxCreationTime,
    slippage,
    addOrder,
    updateOrder,
    orders,
  } = useTradingContext();

  const { blacklistedUsers, addToBlacklist, isBlacklisted } = useBlacklistContext();
  const { isBuylisted } = useBuylistContext();
  const [tweets, setTweets] = useState<LocalTweet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [expandedTweets, setExpandedTweets] = useState<Set<string>>(new Set());
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
  const [searchTerm, setSearchTerm] = useState('');

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
  const twitterServiceRef = useRef(TwitterService.getInstance());

  const handleBuy = async (tweet: LocalTweet) => {
    if (!tweet.mintAddress) return;
    
    const client = tweet.source_type === 'pumpfun' ? pumpFunClient : dexscreenerClient;
    if (!client) return;
    
    let pendingOrder: OrderStatus | undefined;
    
    try {
      setBuyLoading(prev => ({ ...prev, [tweet.id]: true }));

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
        setTxSignatures(prev => ({ ...prev, [tweet.id]: signature }));
        
        // Update order status to success immediately
        if (pendingOrder) {
          updateOrder(pendingOrder.id, {
            status: 'success',
            signature
          });

          // Remove successful order after 15 seconds
          setTimeout(() => {
            if (pendingOrder) {
              updateOrder(pendingOrder.id, { status: 'removed' });
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
            updateOrder(pendingOrder.id, { status: 'removed' });
          }
        }, 15000);
      }
    } finally {
      setBuyLoading(prev => ({ ...prev, [tweet.id]: false }));
    }
  };

  const handleAutoBuy = async (tweet: LocalTweet) => {
    if (!tweet.mintAddress) return;
    
    const autoBuyKey = `autobuy_${tweet.id}`;
    
    // Check if we've already tried to autobuy this tweet
    const autoBuyAttempted = localStorage.getItem(autoBuyKey);
    if (autoBuyAttempted) return;
    
    let pendingOrder: OrderStatus | undefined;
    
    try {
      setBuyLoading(prev => ({ ...prev, [tweet.id]: true }));

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
        setTxSignatures(prev => ({ ...prev, [tweet.id]: signature }));
        
        // Update order status to success immediately
        if (pendingOrder) {
          updateOrder(pendingOrder.id, {
            status: 'success',
            signature
          });

          // Remove successful order after 15 seconds
          setTimeout(() => {
            if (pendingOrder) {
              updateOrder(pendingOrder.id, { status: 'removed' });
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
            updateOrder(pendingOrder.id, { status: 'removed' });
          }
        }, 15000);
      }
    } finally {
      setBuyLoading(prev => ({ ...prev, [tweet.id]: false }));
      // Mark this tweet as attempted for autobuy
      localStorage.setItem(autoBuyKey, 'true');
    }
  };

  const checkAndAutoBuy = useCallback((tweet: LocalTweet) => {
    // Check if we've already tried to autobuy this tweet
    const autoBuyKey = `autobuy_${tweet.id}`;
    
    const userIsBuylisted = isBuylisted(tweet.user.screen_name);
    const userIsBlacklisted = isBlacklisted(tweet.user.screen_name);
    const meetsFollowerRequirement = tweet.user.followers_count >= minFollowers;

    // Check if token meets creation time requirement
    const tokenCreationTime = tweet.tokenInfo?.createdTimestamp || 0;
    const currentTime = Date.now() / 1000; // Convert to seconds
    const tokenAgeInMinutes = (currentTime - tokenCreationTime) / 60;
    const meetsCreationTimeRequirement = !creationTimeEnabled || tokenAgeInMinutes <= maxCreationTime;
    
    // Determine if we should buy based on user lists and settings
    const shouldBuyBasedOnUser = 
      // Always buy from buylisted users (unless blacklisted)
      (userIsBuylisted && !userIsBlacklisted) ||
      // For non-buylisted users, check follower and creation time requirements
      (!userIsBuylisted && !userIsBlacklisted && 
        (!followerCheckEnabled || meetsFollowerRequirement) && 
        meetsCreationTimeRequirement);

    // Check all other conditions
    const shouldBuy = 
      autoBuyEnabled &&
      tweet.mintAddress &&
      tweet.tokenInfo &&
      !txSignatures[tweet.id] &&
      !buyLoading[tweet.id] &&
      privateKey &&
      (tweet.source_type === 'pumpfun' ? pumpFunClient : dexscreenerClient) &&
      !purchasedMints.has(tweet.mintAddress) &&
      !localStorage.getItem(autoBuyKey) &&
      shouldBuyBasedOnUser;

    if (shouldBuy) {
      // Determine the reason for buying
      const buyReason = userIsBuylisted 
        ? 'User is buylisted' 
        : `Meets requirements (Followers: ${meetsFollowerRequirement}, Creation Time: ${meetsCreationTimeRequirement})`;

      console.log('Auto-buying token from tweet:', {
        tweetId: tweet.id,
        user: tweet.user.screen_name,
        followers: tweet.user.followers_count,
        tokenAge: Math.round(tokenAgeInMinutes),
        mintAddress: tweet.mintAddress,
        tokenSymbol: tweet.tokenInfo?.symbol || 'Unknown',
        isBuylisted: userIsBuylisted,
        followerCheckEnabled,
        minFollowers: followerCheckEnabled ? minFollowers : 'disabled',
        buyReason
      });
      handleAutoBuy(tweet);
    }
  }, [autoBuyEnabled, minFollowers, followerCheckEnabled, txSignatures, buyLoading, privateKey, pumpFunClient, dexscreenerClient, isBlacklisted, purchasedMints, isBuylisted, creationTimeEnabled, maxCreationTime]);

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
    const tweetTime = parseInt(timestamp);
    const now = Date.now();
    const diffInSeconds = Math.floor((now - tweetTime) / 1000);
    
    if (diffInSeconds < 60) {
      return `${diffInSeconds}s`;
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
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
      
      if (source_type === 'pumpfun') {
        console.log('Using pump-proxy for Pump.fun token');
        const url = `/api/pump-proxy?mintAddress=${encodeURIComponent(idOrAddress)}`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          console.error(`Pump.fun API error: ${response.status} ${response.statusText}`);
          const errorData = await response.json().catch(() => ({}));
          console.error('Error details:', errorData);
          return undefined;
        }

        const data = await response.json();
        
        // Handle the new API response format
        const createdTimestamp = data.created_timestamp 
          ? Math.floor(data.created_timestamp / 1000) // Convert from milliseconds to seconds
          : Math.floor(Date.now() / 1000);
        
        // Use usd_market_cap directly from the API
        const marketCap = data.usd_market_cap || 0;
        
        // Calculate price from total supply and market cap
        const price = data.total_supply > 0 
          ? marketCap / (data.total_supply / 1e9) 
          : 0;
        
        return {
          symbol: data.symbol || '???',
          name: data.name || 'Unknown Token',
          imageUrl: data.image_uri || '',
          price: price,
          marketCap: marketCap,
          createdTimestamp: createdTimestamp
        };
      } 
      else {
        console.log('Using Dexscreener API for pair ID:', idOrAddress);
        
        // First try as a pair address
        const pairResponse = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${idOrAddress}`);
        const pairData = await pairResponse.json();
        
        if (pairData.pairs && pairData.pairs.length > 0) {
          const pair = pairData.pairs[0];
          return {
            symbol: pair.baseToken.symbol,
            name: pair.baseToken.name,
            imageUrl: '', // Dexscreener doesn't provide token images
            price: parseFloat(pair.priceUsd) || 0,
            marketCap: pair.marketCap || 0,
            createdTimestamp: pair.pairCreatedAt ? Math.floor(pair.pairCreatedAt / 1000) : Math.floor(Date.now() / 1000)
          };
        }
        
        // If no pair found, try as a token address
        console.log('No pair found, trying as token address');
        const tokenResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${idOrAddress}`);
        const tokenData = await tokenResponse.json();
        
        if (tokenData.pairs && tokenData.pairs.length > 0) {
          const solanaPair = tokenData.pairs.find((pair: { chainId: string }) => pair.chainId === 'solana');
          if (solanaPair) {
            return {
              symbol: solanaPair.baseToken.symbol,
              name: solanaPair.baseToken.name,
              imageUrl: '',
              price: parseFloat(solanaPair.priceUsd) || 0,
              marketCap: solanaPair.marketCap || 0,
              createdTimestamp: solanaPair.pairCreatedAt ? Math.floor(solanaPair.pairCreatedAt / 1000) : Math.floor(Date.now() / 1000)
            };
          }
        }
        
        console.log('No token data found in Dexscreener response');
        return undefined;
      }
    } catch (error) {
      console.error('Error fetching token info:', error);
      return undefined;
    }
  };

  const updateTweetPrices = async () => {
    if (!pumpFunClient && !dexscreenerClient) return;

    console.log('Updating tweet prices...');
    const updatedTweets = await Promise.all(
      tweets.map(async tweet => {
        // Only update prices every 30 seconds
        if (!tweet.mintAddress || (tweet.lastPriceCheck && Date.now() - tweet.lastPriceCheck < 30000)) {
          return tweet;
        }

        try {
          let price: number | undefined;
          
          if (tweet.source_type === 'pumpfun' && pumpFunClient) {
            const pumpPrice = await pumpFunClient.getTokenPrice(tweet.mintAddress);
            price = pumpPrice ?? undefined;
            console.log(`Updated Pump.fun price for ${tweet.mintAddress}: ${price}`);
          } else if (tweet.source_type === 'dexscreener' && dexscreenerClient) {
            price = await dexscreenerClient.getTokenPrice(tweet.mintAddress);
            console.log(`Updated DEXScreener price for ${tweet.mintAddress}: ${price}`);
          }

          if (price !== undefined) {
            if (tweet.tokenInfo) {
              tweet.tokenInfo.price = price;
            }
            return {
              ...tweet,
              pricePerToken: price,
              lastPriceCheck: Date.now()
            };
          }
        } catch (error) {
          console.error('Error updating price for tweet:', error);
        }
        return tweet;
      })
    );

    // Sort tweets by creation time
    const sortedTweets = updatedTweets.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    setTweets(sortedTweets);
  };

  const extractMintAddress = (tweet: LocalTweet): string | undefined => {
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
      
      // Initialize both clients with trading settings
      const pumpClient = new PumpFunClient(
        connection, 
        keypair,
        undefined, // rpcEndpoint is optional
        {
          followerCheckEnabled,
          minFollowers,
          creationTimeEnabled,
          maxCreationTime
        }
      );
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

  useEffect(() => {
    initClients();
  }, [privateKey]);

  useEffect(() => {
    if (pumpFunClient) {
      initClients();
    }
  }, [followerCheckEnabled, minFollowers, creationTimeEnabled, maxCreationTime]);

  const handleNewTweets = async (newTweets: ImportedTweet[], type: 'pumpfun' | 'dexscreener') => {
    if (isPaused) {
      console.log('Tweet processing paused');
      return;
    }

    try {
      setLoading(true);
      
      // Process new tweets to get token info
      const processedTweets = await Promise.all(newTweets.map(async tweet => {
        const localTweet = {
          ...tweet,
          full_text: tweet.text,
          source_type: type
        } as LocalTweet;

        // Extract mint address
        const mintAddress = extractMintAddress(localTweet);
        if (mintAddress) {
          localTweet.mintAddress = mintAddress;
          // Fetch token info
          const tokenInfo = await fetchTokenInfo(mintAddress, type);
          if (tokenInfo) {
            localTweet.tokenInfo = tokenInfo;
            // Get initial price
            if (type === 'pumpfun' && pumpFunClient) {
              const pumpPrice = await pumpFunClient.getTokenPrice(mintAddress);
              localTweet.pricePerToken = pumpPrice ?? undefined;
            } else if (type === 'dexscreener' && dexscreenerClient) {
              localTweet.pricePerToken = await dexscreenerClient.getTokenPrice(mintAddress);
            }
            localTweet.lastPriceCheck = Date.now();
          }
        }
        
        return localTweet;
      }));
      
      setTweets(prevTweets => {
        // Combine new and existing tweets
        const updatedTweets = [...processedTweets, ...prevTweets];
        // Sort by creation time, newest first
        const sortedTweets = updatedTweets.sort((a, b) => 
          parseInt(b.created_at) - parseInt(a.created_at)
        );
        // Keep only the 100 most recent tweets
        return sortedTweets.slice(0, 100);
      });

    } catch (err) {
      console.error('Error processing tweets:', err);
      setError('Failed to process tweets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const twitterService = twitterServiceRef.current;
    const cleanup = twitterService.subscribe(handleNewTweets);

    // Load initial cached tweets
    const pumpfunTweets = twitterService.getCachedTweets('pumpfun');
    const dexscreenerTweets = twitterService.getCachedTweets('dexscreener');
    
    if (pumpfunTweets.length > 0) {
      handleNewTweets(pumpfunTweets, 'pumpfun');
    }
    if (dexscreenerTweets.length > 0) {
      handleNewTweets(dexscreenerTweets, 'dexscreener');
    }

    // Update prices periodically
    const priceInterval = setInterval(updateTweetPrices, 30000);

    return () => {
      cleanup();
      clearInterval(priceInterval);
    };
  }, [isPaused]);

  useEffect(() => {
    const interval = setInterval(() => {
      orders.forEach(order => {
        if (order.status !== 'removed') {
          updateOrder(order.id, { status: 'removed' });
        }
      });
    }, 15000);
    return () => clearInterval(interval);
  }, [orders, updateOrder]);

  const filteredTweets = tweets.filter(tweet => {
    if (!tweet) {
      console.log('Found null tweet in filter');
      return false;
    }

    const matchesSearch = !searchTerm || 
      tweet.full_text.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tweet.user.screen_name.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = activeSourceTypes.has(tweet.source_type);
    
    if (!matchesSearch || !matchesType) {
      console.log(`Tweet ${tweet.id} filtered out:`, {
        matchesSearch,
        matchesType,
        activeSourceTypes: Array.from(activeSourceTypes),
        tweetType: tweet.source_type
      });
    }
    
    return matchesSearch && matchesType;
  });

  const getTweetUrl = (tweet: LocalTweet) => {
    return `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id}`;
  };

  const getDexscreenerUrl = (tweet: LocalTweet): string => {
    if (!tweet.entities.urls.length) return 'https://dexscreener.com';
    const url = tweet.entities.urls[0].expanded_url;
    const [baseUrl, params] = url.split('?');
    return baseUrl;
  };

  const getPumpFunUrl = (tweet: LocalTweet): string => {
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
              .sort((a, b) => parseInt(b.created_at) - parseInt(a.created_at))
              .map((tweet) => (
              <div
                key={tweet.id}
                className={`bg-gray-900 rounded-lg shadow-lg border border-gray-700 p-3 hover:border-gray-600 transition-colors ${
                  tweet.source_type === 'pumpfun' 
                    ? 'border-l-4 border-l-blue-500'
                    : 'border-l-4 border-l-green-500'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-start space-x-3">
                    <img 
                      src={tweet.user.profile_image_url_https} 
                      alt={tweet.user.screen_name}
                      className="w-10 h-10 rounded-full"
                    />
                    <div>
                      <div className="flex items-center space-x-1">
                        <span className="font-medium text-white">{tweet.user.name}</span>
                        <span className="text-gray-500">@{tweet.user.screen_name}</span>
                      </div>
                      <div className="text-xs text-gray-500 flex items-center space-x-2">
                        <div className="flex items-center space-x-1">
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                          </svg>
                          <span>{formatFollowerCount(tweet.user.followers_count)}</span>
                        </div>
                        {!isBlacklisted(tweet.user.screen_name) && (
                          <button
                            onClick={() => addToBlacklist(tweet.user.screen_name)}
                            className="text-gray-500 hover:text-gray-400 transition-colors"
                            title="Blacklist user"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex space-x-2">
                      <a
                        href={getTweetUrl(tweet)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-gray-400 transition-colors"
                        title="View on Twitter"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M23.643 4.937c-.835.37-1.732.62-2.675.733.962-.576 1.7-1.49 2.048-2.578-.9.534-1.897.922-2.958 1.13-.85-.904-2.06-1.47-3.4-1.47-2.572 0-4.658 2.086-4.658 4.66 0 .364.042.718.12 1.06-3.873-.195-7.304-2.05-9.602-4.868-.4.69-.63 1.49-.63 2.342 0 1.616.823 3.043 2.072 3.878-.764-.025-1.482-.234-2.11-.583v.06c0 2.257 1.605 4.14 3.737 4.568-.392.106-.803.162-1.227.162-.3 0-.593-.028-.877-.082 2.062 1.323 4.51 2.093 7.14 2.093 8.57 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602.91-.658 1.7-1.477 2.323-2.41z" />
                      </svg>
                    </a>
                      <a
                        href={tweet.source_type === 'pumpfun' ? getPumpFunUrl(tweet) : getDexscreenerUrl(tweet)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-gray-400 transition-colors"
                        title={tweet.source_type === 'pumpfun' ? "View on Pump.fun" : "View on DEXScreener"}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                    {privateKey && (
                      <button
                        onClick={() => handleBuy(tweet)}
                        disabled={buyLoading[tweet.id] || !!txSignatures[tweet.id]}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors whitespace-nowrap ${
                          buyLoading[tweet.id]
                            ? 'bg-gray-500/10 text-gray-400 cursor-not-allowed border border-gray-500/20'
                            : txSignatures[tweet.id]
                            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                            : privateKey
                            ? 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 border border-yellow-500/20'
                            : 'bg-gray-500/10 text-gray-400 cursor-not-allowed border border-gray-500/20'
                        }`}
                      >
                        {buyLoading[tweet.id]
                          ? 'Buying...'
                          : txSignatures[tweet.id]
                          ? 'Bought'
                          : 'Buy'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex-grow">
                  {tweet.tokenInfo ? (
                    <div className="text-xs bg-gray-700/50 rounded p-2 space-y-1 flex-grow">
                      <div className="flex justify-between text-gray-400">
                        <span>Token:</span>
                        <span className="text-yellow-400">
                          {tweet.tokenInfo.symbol} ({tweet.tokenInfo.name})
                        </span>
                      </div>
                      <div className="flex justify-between text-gray-400">
                        <span>Market Cap:</span>
                        <span className="text-yellow-400">
                          ${formatMarketCap(tweet.tokenInfo.marketCap)}
                        </span>
                      </div>
                      <div className="flex justify-between text-gray-400">
                        <span>Created:</span>
                        <span className="text-yellow-400">
                          {formatCreationTime(tweet.tokenInfo.createdTimestamp)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500">Loading token information...</p>
                  )}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  <span title={new Date(parseInt(tweet.created_at)).toLocaleString()}>
                    {formatTweetTime(tweet.created_at)}
                  </span>
                  {' • '}
                  <span>
                    {tweet.source_type === 'pumpfun' ? 'Pump.fun' : 'DEXScreener'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
