import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram
} from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@project-serum/anchor';
import bs58 from 'bs58';
import fetch from 'cross-fetch';
import { COMPUTE_UNIT_LIMIT, PRIORITY_RATE } from './constants';

interface SwapQuote {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
}

interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: number;
  outAmount: number;
  otherAmountThreshold: number;
  swapMode: string;
  slippageBps: number;
  platformFee: null | {
    amount: string;
    feeBps: number;
  };
  priceImpactPct: number;
  routePlan: Array<{
    swapInfo: {
      inputMint: string;
      outputMint: string;
      quoteMint: string;
    };
    percent: number;
  }>;
  contextSlot: number;
  timeTaken: number;
}

class DexscreenerClient {
  private connection: Connection;
  private wallet: Keypair;
  private provider: AnchorProvider;
  private rpcEndpoint: string;

  constructor(connection: Connection, payer: Keypair, rpcEndpoint?: string) {
    this.connection = connection;
    this.wallet = payer;
    this.rpcEndpoint = rpcEndpoint || process.env.NEXT_PUBLIC_HELIUS_RPC_URL || '';

    // Create a wallet adapter that implements the Wallet interface
    const walletAdapter: Wallet = {
      publicKey: payer.publicKey,
      signTransaction: async (tx: any) => {
        tx.partialSign(payer);
        return tx;
      },
      signAllTransactions: async (txs: any[]) => {
        txs.forEach(tx => tx.partialSign(payer));
        return txs;
      },
      payer: payer
    };
    
    // Initialize AnchorProvider with the wallet adapter
    this.provider = new AnchorProvider(
      connection,
      walletAdapter,
      { commitment: 'confirmed' }
    );
  }

  public async getTokenPrice(mintAddress: string): Promise<number | undefined> {
    try {
      // First try to get price from DexScreener API
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`);
      const data = await response.json();
      
      if (data.pairs && data.pairs.length > 0) {
        // Find the first Solana pair
        const solanaPair = data.pairs.find((pair: any) => pair.chainId === 'solana');
        if (solanaPair && solanaPair.priceUsd) {
          return parseFloat(solanaPair.priceUsd);
        }
      }

      // If no price found on DexScreener, try Jupiter
      const quoteResponse = await this.getQuote({
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: mintAddress,
        amount: LAMPORTS_PER_SOL, // 1 SOL in lamports
        slippageBps: 50
      });

      if (quoteResponse) {
        // Return how many tokens you get for 1 SOL
        return quoteResponse.outAmount / Math.pow(10, 9); // Assuming 9 decimals for token
      }
      
      return undefined;
    } catch (error) {
      console.error('Error fetching token price:', error);
      return undefined;
    }
  }

  private async getQuote(params: SwapQuote): Promise<QuoteResponse> {
    const { inputMint, outputMint, amount, slippageBps } = params;
    
    try {
      // First check if the token is indexed by Jupiter
      const indexResponse = await fetch(`https://token.jup.ag/all`);
      const indexData = await indexResponse.json();
      
      if (!indexData.tokens.some((token: any) => token.address === outputMint)) {
        console.log(`Token ${outputMint} is not yet indexed by Jupiter`);
        throw new Error(`Token ${outputMint} is not yet available for trading on Jupiter`);
      }

      console.log(`Fetching quote for ${amount} input tokens...`);
      const response = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}\
&outputMint=${outputMint}\
&amount=${amount}\
&slippageBps=${slippageBps}\
&maxAccounts=54`
      );
      
      const quoteResponse = await response.json();
      console.log('Quote response:', quoteResponse);
      
      if (quoteResponse.error) {
        throw new Error(`Failed to get quote: ${quoteResponse.error}`);
      }

      // Check if we have any routes
      if (!quoteResponse.data || !quoteResponse.data.routePlan || quoteResponse.data.routePlan.length === 0) {
        throw new Error(`No trading routes available for token ${outputMint}`);
      }

      return quoteResponse.data;
    } catch (error: any) {
      console.error('Error in getQuote:', error);
      // Enhance error message for better debugging
      if (error.message.includes('Failed to fetch')) {
        throw new Error(`Jupiter API request failed. Please check your internet connection and try again.`);
      }
      throw error;
    }
  }

  public async buyToken(outputMint: string, solAmount: number, slippageBps: number = 100) {
    try {
      // Convert SOL amount to lamports
      const amountInLamports = solAmount * LAMPORTS_PER_SOL;

      // 1. Get quote
      const quoteResponse = await this.getQuote({
        inputMint: 'So11111111111111111111111111111111111111112', // SOL mint address
        outputMint,
        amount: amountInLamports,
        slippageBps
      });

      // 2. Get swap transaction
      const { swapTransaction } = await this.getSwapTransaction(quoteResponse);

      // 3. Deserialize and sign the transaction
      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      // Sign the transaction
      transaction.sign([this.wallet]);

      // 4. Execute the transaction
      const latestBlockhash = await this.connection.getLatestBlockhash();
      const rawTransaction = transaction.serialize();
      const txid = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 2
      });

      // Wait for confirmation
      const confirmation = await this.connection.confirmTransaction({
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        signature: txid
      });

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }

      return {
        success: true,
        signature: txid,
        explorerUrl: `https://solscan.io/tx/${txid}`
      };
    } catch (error: any) {
      console.error('Error buying token:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async getSwapTransaction(quoteResponse: QuoteResponse) {
    const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: this.wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: PRIORITY_RATE,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
        dynamicSlippage: { maxBps: 300 }
      })
    });

    const swapData = await swapResponse.json();
    if (swapData.error) {
      throw new Error(`Failed to get swap transaction: ${swapData.error}`);
    }
    return swapData;
  }

  public async getTokenCreationTime(mintAddress: string): Promise<number | undefined> {
    try {
      // Try to get token info from DexScreener API
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`);
      const data = await response.json();
      
      if (data.pairs && data.pairs.length > 0) {
        // Find the first Solana pair
        const solanaPair = data.pairs.find((pair: any) => pair.chainId === 'solana');
        if (solanaPair && solanaPair.pairCreatedAt) {
          // DexScreener returns timestamp in milliseconds, convert to seconds
          return Math.floor(solanaPair.pairCreatedAt / 1000);
        }
      }
      
      return undefined;
    } catch (error) {
      console.error('Error fetching token creation time:', error);
      return undefined;
    }
  }
}

export { DexscreenerClient };
