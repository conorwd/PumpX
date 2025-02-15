import { Tweet } from '../types';

export type TweetType = 'pumpfun' | 'dexscreener';

interface TwitterUser {
  id: number;
  id_str: string;
  name: string;
  screen_name: string;
  profile_image_url_https: string;
  followers_count: number;
  verified: boolean;
}

interface TwitterEntities {
  urls: Array<{
    display_url: string;
    expanded_url: string;
    indices: number[];
    url: string;
  }>;
  media?: Array<{
    display_url: string;
    expanded_url: string;
    media_url_https: string;
    type: string;
    url: string;
  }>;
}

interface RawTweet {
  created_at: string;
  id: number;
  id_str: string;
  text: string | null;
  full_text: string;
  user: TwitterUser;
  entities: TwitterEntities;
  quoted_status?: RawTweet;
  retweet_count: number;
  favorite_count: number;
  views_count: number | null;
  bookmark_count: number | null;
  tweet_created_at: string;
  mint_address?: string;
  token_info?: {
    symbol: string;
    name: string;
    image_url: string;
    price: number;
    market_cap: number;
    created_timestamp: number;
  };
}

interface WebSocketMessage {
  type: 'tweets';
  queryType: TweetType;
  data: RawTweet[];
}

interface SearchConfig {
  type: TweetType;
  urlPattern: string;
}

export class TwitterService {
  private static instance: TwitterService | null = null;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly wsUrl: string;
  private subscribers: ((tweets: Tweet[], type: TweetType) => void)[] = [];
  private cachedTweets: { [key in TweetType]: Tweet[] } = {
    pumpfun: [],
    dexscreener: []
  };
  private processedTweetIds: Set<string> = new Set();
  private searchConfigs: SearchConfig[];

  private constructor() {
    // Ensure the WebSocket URL is properly formatted
    const wsUrl = process.env.NEXT_PUBLIC_TWITTER_WS_URL || '';
    this.wsUrl = wsUrl.startsWith('ws://') || wsUrl.startsWith('wss://') 
      ? wsUrl 
      : `wss://${wsUrl}`;

    this.searchConfigs = [
      { 
        type: 'pumpfun',
        urlPattern: 'pump.fun/coin/'
      },
      { 
        type: 'dexscreener',
        urlPattern: 'dexscreener.com/solana/'
      }
    ];

    if (typeof window !== 'undefined') {
      this.connect();
    }
  }

  public static getInstance(): TwitterService {
    if (!TwitterService.instance) {
      TwitterService.instance = new TwitterService();
    }
    return TwitterService.instance;
  }

  private transformTweet(rawTweet: RawTweet): Tweet {
    // Handle null text content
    if (!rawTweet.text && !rawTweet.full_text) {
      console.log('Tweet has no text content, skipping transformation:', rawTweet.id_str);
      return {
        id: rawTweet.id_str,
        text: '',
        created_at: Date.now().toString(),
        user: rawTweet.user,
        entities: {
          urls: []
        },
        source_type: 'pumpfun',
        retweet_count: rawTweet.retweet_count,
        favorite_count: rawTweet.favorite_count,
        views_count: rawTweet.views_count ?? null,
        bookmark_count: rawTweet.bookmark_count ?? null,
        mintAddress: rawTweet.mint_address,
        tokenInfo: rawTweet.token_info ? {
          symbol: rawTweet.token_info.symbol,
          name: rawTweet.token_info.name,
          imageUrl: rawTweet.token_info.image_url,
          price: rawTweet.token_info.price,
          marketCap: rawTweet.token_info.market_cap,
          createdTimestamp: rawTweet.token_info.created_timestamp
        } : undefined
      };
    }

    // Combine URLs from both entities.urls and entities.media
    const urls = [
      ...(rawTweet.entities?.urls || []),
      ...(rawTweet.entities?.media || [])
    ].map(url => ({
      display_url: url.display_url,
      expanded_url: url.expanded_url,
      url: url.url
    }));

    console.log('Transforming tweet:', rawTweet.id_str);
    
    console.log('Raw tweet timestamp:', rawTweet.tweet_created_at);
    // Parse the timestamp and convert to current timezone
    const createdAtMs = new Date(rawTweet.tweet_created_at?.replace('.000000Z', 'Z') || Date.now()).getTime();
    console.log('Converted timestamp:', createdAtMs);
    
    const tweet: Tweet = {
      id: rawTweet.id_str,
      text: rawTweet.full_text || rawTweet.text || '',
      created_at: createdAtMs.toString(),
      user: {
        name: rawTweet.user.name,
        screen_name: rawTweet.user.screen_name,
        profile_image_url_https: rawTweet.user.profile_image_url_https,
        followers_count: rawTweet.user.followers_count,
        verified: rawTweet.user.verified
      },
      entities: {
        urls: urls
      },
      source_type: 'pumpfun', 
      retweet_count: rawTweet.retweet_count,
      favorite_count: rawTweet.favorite_count,
      views_count: rawTweet.views_count ?? null,
      bookmark_count: rawTweet.bookmark_count ?? null,
      mintAddress: rawTweet.mint_address,
      tokenInfo: rawTweet.token_info ? {
        symbol: rawTweet.token_info.symbol,
        name: rawTweet.token_info.name,
        imageUrl: rawTweet.token_info.image_url,
        price: rawTweet.token_info.price,
        marketCap: rawTweet.token_info.market_cap,
        createdTimestamp: rawTweet.token_info.created_timestamp
      } : undefined
    };

    if (rawTweet.quoted_status) {
      tweet.quoted_status = this.transformTweet(rawTweet.quoted_status);
    }

    console.log('Transformed tweet:', tweet);
    return tweet;
  }

  private connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    console.log('Connecting to tweet stream...');
    this.ws = new WebSocket(this.wsUrl);
    this.setupEventHandlers();
  }

  private isTweetProcessed(tweetId: string, type: TweetType): boolean {
    const key = `${type}_${tweetId}`;
    return this.processedTweetIds.has(key);
  }

  private markTweetAsProcessed(tweetId: string, type: TweetType): void {
    const key = `${type}_${tweetId}`;
    this.processedTweetIds.add(key);
  }

  private setupEventHandlers() {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('Connected to tweet stream');
      this.reconnectAttempts = 0;
      this.subscribeToAllTweets();
    };

    this.ws.onmessage = (event) => {
      try {
        console.log('Received WebSocket message:', event.data);
        const message = JSON.parse(event.data) as WebSocketMessage;
        
        if (message.type === 'tweets' && Array.isArray(message.data)) {
          console.log(`Processing ${message.data.length} tweets of type ${message.queryType}`);
          
          // Filter out already processed tweets
          const newTweets = message.data.filter(tweet => !this.isTweetProcessed(tweet.id_str, message.queryType));
          
          if (newTweets.length === 0) {
            console.log('All tweets in this batch were already processed');
            return;
          }

          const transformedTweets = newTweets.map(tweet => {
            const transformedTweet = this.transformTweet(tweet);
            transformedTweet.source_type = message.queryType;
            // Mark the tweet as processed
            this.markTweetAsProcessed(tweet.id_str, message.queryType);
            return transformedTweet;
          });

          // Create a map of existing tweets for faster lookup
          const existingTweetsMap = new Map(
            this.cachedTweets[message.queryType].map(tweet => [tweet.id, tweet])
          );

          // Add new tweets to the map, replacing any existing ones
          transformedTweets.forEach(tweet => {
            existingTweetsMap.set(tweet.id, tweet);
          });

          // Convert map back to array and sort by creation time
          this.cachedTweets[message.queryType] = Array.from(existingTweetsMap.values())
            .sort((a, b) => parseInt(b.created_at) - parseInt(a.created_at));

          // Notify subscribers only if we have new tweets
          if (transformedTweets.length > 0) {
            console.log('Notifying subscribers with processed tweets:', transformedTweets);
            this.subscribers.forEach(callback => {
              callback(transformedTweets, message.queryType);
            });
          }
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket connection closed');
      this.handleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private subscribeToAllTweets() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.searchConfigs.forEach(config => {
      const subscription = {
        query: config.urlPattern,
        type: config.type
      };
      console.log('Sent subscription:', subscription);
      this.ws?.send(JSON.stringify(subscription));
    });
  }

  private handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;

    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  public subscribe(callback: (tweets: Tweet[], type: TweetType) => void) {
    this.subscribers.push(callback);
    return () => this.subscribers = this.subscribers.filter(cb => cb !== callback);
  }

  public unsubscribe(callback: (tweets: Tweet[], type: TweetType) => void) {
    this.subscribers = this.subscribers.filter(cb => cb !== callback);
  }

  public getCachedTweets(type: TweetType): Tweet[] {
    // Return a fresh sorted copy of the cached tweets
    return [...this.cachedTweets[type]]
      .sort((a, b) => parseInt(b.created_at) - parseInt(a.created_at));
  }

  public getAllCachedTweets(): Tweet[] {
    // Combine and sort all tweets from both sources
    const allTweets = [
      ...this.cachedTweets.pumpfun,
      ...this.cachedTweets.dexscreener
    ];

    // Create a map to deduplicate by ID
    const uniqueTweets = new Map<string, Tweet>();
    allTweets.forEach(tweet => {
      const key = `${tweet.source_type}_${tweet.id}`;
      if (!uniqueTweets.has(key)) {
        uniqueTweets.set(key, tweet);
      }
    });

    // Convert back to array and sort by creation time
    return Array.from(uniqueTweets.values())
      .sort((a, b) => parseInt(b.created_at) - parseInt(a.created_at));
  }

  public clearProcessedTweets(): void {
    this.processedTweetIds.clear();
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribers = [];
    this.cachedTweets = {
      pumpfun: [],
      dexscreener: []
    };
    this.processedTweetIds.clear();
  }

  public reconnect() {
    console.log('Forcing reconnection to tweet stream...');
    if (this.ws) {
      this.ws.close();
    }
    this.reconnectAttempts = 0;
    this.connect();
  }
}

// Export singleton instance
export const twitterService = TwitterService.getInstance();
