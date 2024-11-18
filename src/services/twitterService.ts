import { Tweet } from '@/types';

interface TweetEntity {
  urls: Array<{
    display_url: string;
    expanded_url: string;
    indices: number[];
    url: string;
  }>;
  hashtags: any[];
  symbols: any[];
  timestamps: any[];
  user_mentions: any[];
}

interface TwitterUser {
  id: number;
  id_str: string;
  name: string;
  screen_name: string;
  location: string | null;
  url: string | null;
  description: string;
  protected: boolean;
  verified: boolean;
  followers_count: number;
  friends_count: number;
  listed_count: number;
  favourites_count: number;
  statuses_count: number;
  created_at: string;
  profile_banner_url: string | null;
  profile_image_url_https: string;
  can_dm: boolean;
}

interface RawTweet {
  tweet_created_at: string;
  id: number;
  id_str: string;
  text: string | null;
  full_text: string;
  source: string;
  truncated: boolean;
  in_reply_to_status_id: number | null;
  in_reply_to_status_id_str: string | null;
  in_reply_to_user_id: number | null;
  in_reply_to_user_id_str: string | null;
  in_reply_to_screen_name: string | null;
  user: TwitterUser;
  quoted_status_id: number | null;
  quoted_status_id_str: string | null;
  is_quote_status: boolean;
  quoted_status: any | null;
  retweeted_status: any | null;
  quote_count: number;
  reply_count: number;
  retweet_count: number;
  favorite_count: number;
  views_count: number | null;
  bookmark_count: number;
  lang: string;
  entities: TweetEntity;
  is_pinned: boolean;
}

interface TwitterSearchResponse {
  tweets: RawTweet[];
  next_cursor: string;
}

export interface SearchConfig {
  query: string;
  type: 'pumpfun' | 'dexscreener';
  urlPattern: string;
}

interface TwitterSearchState {
  lastTweetId: string | null;
  isFirstRequest: boolean;
}

export class TwitterService {
  private apiKey: string;
  private searchStates: Map<string, TwitterSearchState>;
  private searchConfigs: SearchConfig[];

  constructor() {
    this.apiKey = process.env.NEXT_PUBLIC_SOCIALDATA_API_KEY || '';
    if (!this.apiKey) {
      console.error('NEXT_PUBLIC_SOCIALDATA_API_KEY is not set in environment variables');
    }
    this.searchStates = new Map();
    this.searchConfigs = [
      { 
        query: 'pump.fun/coin/', 
        type: 'pumpfun',
        urlPattern: 'pump.fun/coin/'
      },
      { 
        query: 'dexscreener.com/solana/', 
        type: 'dexscreener',
        urlPattern: 'dexscreener.com/solana/'
      }
    ];
    
    // Initialize search states
    this.searchConfigs.forEach(config => {
      this.searchStates.set(config.type, {
        lastTweetId: null,
        isFirstRequest: true
      });
    });
  }

  private buildQuery(config: SearchConfig): string {
    const state = this.searchStates.get(config.type)!;
    const baseQuery = `${config.query} -filter:retweets`;
    
    if (state.isFirstRequest) {
      // First request: get tweets from last 10 minutes
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - (10 * 60);
      return `${baseQuery} since_time:${tenMinutesAgo}`;
    } else if (state.lastTweetId) {
      // Subsequent requests: get tweets newer than last seen tweet
      return `${baseQuery} since_id:${state.lastTweetId}`;
    }
    
    // Fallback to last 30 seconds if something went wrong
    const thirtySecondsAgo = Math.floor(Date.now() / 1000) - 30;
    return `${baseQuery} since_time:${thirtySecondsAgo}`;
  }

  private transformTweet(rawTweet: RawTweet, searchConfig: SearchConfig): Tweet {
    // Find the matching URL for the search config type
    const matchingUrl = rawTweet.entities.urls.find(url => 
      url.expanded_url.includes(searchConfig.urlPattern)
    );

    return {
      id_str: rawTweet.id_str,
      full_text: rawTweet.full_text,
      tweet_created_at: rawTweet.tweet_created_at,
      user: {
        name: rawTweet.user.name,
        screen_name: rawTweet.user.screen_name,
        profile_image_url_https: rawTweet.user.profile_image_url_https,
        followers_count: rawTweet.user.followers_count,
        friends_count: rawTweet.user.friends_count
      },
      entities: {
        urls: matchingUrl ? [{ expanded_url: matchingUrl.expanded_url }] : []
      },
      source_type: searchConfig.type
    };
  }

  async searchTweets(): Promise<Tweet[]> {
    if (!this.apiKey) {
      console.error('Twitter API key is not configured');
      return [];
    }

    try {
      const allTweets: Tweet[] = [];

      // Fetch tweets for each search configuration
      for (const config of this.searchConfigs) {
        try {
          const query = this.buildQuery(config);
          console.log(`Searching tweets for ${config.type}:`, { query });

          const params = new URLSearchParams({
            query,
            type: 'Latest'
          });

          const response = await fetch(
            `https://api.socialdata.tools/twitter/search?${params}`,
            {
              headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Accept': 'application/json'
              }
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Twitter API Error for ${config.type}:`, response.status, errorText);
            continue;
          }

          const data: TwitterSearchResponse = await response.json();

          if (!data || !Array.isArray(data.tweets)) {
            console.error(`Unexpected response format for ${config.type}:`, data);
            continue;
          }

          // Filter and transform tweets
          const relevantTweets = data.tweets
            .filter(tweet => 
              tweet.entities.urls.some(url => 
                url.expanded_url.includes(config.urlPattern)
              )
            )
            .map(tweet => this.transformTweet(tweet, config));

          console.log(`Found ${relevantTweets.length} tweets for ${config.type}`);

          if (relevantTweets.length > 0) {
            // Update lastTweetId with the newest tweet's ID
            const state = this.searchStates.get(config.type)!;
            state.lastTweetId = relevantTweets[0].id_str;
            state.isFirstRequest = false;
            this.searchStates.set(config.type, state);
          }

          allTweets.push(...relevantTweets);
        } catch (error) {
          console.error(`Error processing ${config.type} tweets:`, error);
        }
      }

      // Sort all tweets by ID (most recent first) and return
      return allTweets.sort((a, b) => b.id_str.localeCompare(a.id_str));
    } catch (error) {
      console.error('Error fetching tweets:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
      }
      return [];
    }
  }
}
