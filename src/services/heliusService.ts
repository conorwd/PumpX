import { TokenInfo } from '@/types';

export class HeliusService {
  private rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  async getAsset(mintAddress: string): Promise<TokenInfo | undefined> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'helius-test',
          method: 'getAsset',
          params: {
            id: mintAddress
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

      const asset = data.result;
      if (!asset) return undefined;

      const pricePerToken = asset.token_info?.price_info?.price_per_token;
      const supply = asset.token_info?.supply || 0;
      const decimals = asset.token_info?.decimals || 0;
      const adjustedSupply = supply / Math.pow(10, decimals);
      const marketCap = pricePerToken && supply ? pricePerToken * adjustedSupply : 0;

      return {
        symbol: asset.content?.metadata?.symbol || '???',
        name: asset.content?.metadata?.name || 'Unknown Token',
        imageUrl: asset.content?.links?.image || '',
        price: pricePerToken,
        marketCap
      };
    } catch (error) {
      console.error('Error fetching asset:', error);
      return undefined;
    }
  }

  async searchAssets(ownerAddress: string): Promise<TokenInfo[]> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'helius-test',
          method: 'searchAssets',
          params: {
            ownerAddress,
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

      return data.result.items
        .filter((asset: any) => asset.id.toLowerCase().endsWith('pump'))
        .map((asset: any) => {
          const pricePerToken = asset.token_info?.price_info?.price_per_token;
          const supply = asset.token_info?.supply || 0;
          const decimals = asset.token_info?.decimals || 0;
          const adjustedSupply = supply / Math.pow(10, decimals);
          const marketCap = pricePerToken && supply ? pricePerToken * adjustedSupply : 0;

          return {
            symbol: asset.content?.metadata?.symbol || '???',
            name: asset.content?.metadata?.name || 'Unknown Token',
            imageUrl: asset.content?.links?.image || '',
            price: pricePerToken,
            marketCap
          };
        });
    } catch (error) {
      console.error('Error searching assets:', error);
      return [];
    }
  }
}
