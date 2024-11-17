export interface TokenInfo {
  symbol: string;
  name: string;
  imageUrl?: string;
  price?: number;
  marketCap?: number;
  createdTimestamp?: number;
}

export interface Tweet {
  id_str: string;
  full_text: string;
  user: {
    name: string;
    screen_name: string;
    profile_image_url_https: string;
    followers_count: number;
    friends_count: number;
  };
  entities: {
    urls: {
      expanded_url: string;
    }[];
  };
  tweet_created_at: string;
  tokenInfo?: TokenInfo;
  mintAddress?: string;
  pricePerToken?: number;
  lastPriceCheck?: number;
}

export interface VirtualReserves {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export interface CoinData {
  mint: string;
  bondingCurve: string;
  associatedBondingCurve: string;
  virtualTokenReserves: number;
  virtualSolReserves: number;
  tokenTotalSupply: number;
  complete: boolean;
}
