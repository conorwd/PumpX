import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  SystemProgram,
  sendAndConfirmTransaction as web3SendAndConfirmTransaction,
  ComputeBudgetProgram
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import BN from 'bn.js';
import {
  PUMP_FUN_PROGRAM,
  GLOBAL,
  FEE_RECIPIENT,
  EVENT_AUTHORITY,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  RENT,
  SOL_DECIMAL,
  TOKEN_DECIMAL,
  COMPUTE_UNIT_LIMIT,
  PRIORITY_RATE
} from './constants';
import axios from 'axios';
import bs58 from 'bs58';

// Common headers for all requests
const COMMON_HEADERS = {
  'accept': '*/*',
  'accept-language': 'en-CA,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
  'content-type': 'application/json',
  'priority': 'u=1, i',
  'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  'solana-client': 'js/1.0.0-maintenance',
  'Referer': 'https://pump.fun/',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

// Define TOKEN_DECIMALS based on your token's decimal places
const TOKEN_DECIMALS = 1_000_000; // If your token has 6 decimals

// Types
interface CoinData {
  mint: string;
  name: string;
  symbol: string;
  bondingCurve: string;
  associatedBondingCurve: string;
  virtualTokenReserves: number;
  virtualSolReserves: number;
  tokenTotalSupply: number;
  complete: boolean;
  usdMarketCap: number;
  marketCap: number;
  creator: string;
  createdTimestamp: number;
}

// Error codes from IDL
enum PumpFunError {
  NotAuthorized = 6000,
  AlreadyInitialized = 6001,
  TooMuchSolRequired = 6002,
  TooLittleSolReceived = 6003,
  MintDoesNotMatchBondingCurve = 6004,
  BondingCurveComplete = 6005,
  BondingCurveNotComplete = 6006,
  NotInitialized = 6007
}

class PumpFunClient {
  private connection: Connection;
  private payer: Keypair;
  private rpcEndpoint: string;
  private lastRequestId: number = 0;
  private tradingSettings: any;
  private lastBuyTimestamp: number = 0;
  private buyAttempts: Map<string, { timestamp: number, count: number }> = new Map();
  private readonly MIN_BUY_INTERVAL = 2000; // 2 seconds between buys
  private readonly MAX_BUY_ATTEMPTS = 3; // Maximum attempts per token within the window
  private readonly BUY_ATTEMPT_WINDOW = 60000; // 1 minute window for attempts

  constructor(connection: Connection, payer: Keypair, rpcEndpoint?: string, tradingSettings?: any) {
    this.connection = connection;
    this.payer = payer;
    this.rpcEndpoint = rpcEndpoint || process.env.NEXT_PUBLIC_HELIUS_RPC_URL || '';
    this.tradingSettings = tradingSettings;
  }

  private getNextRequestId(): string {
    this.lastRequestId++;
    return this.lastRequestId.toString();
  }

  private async getCoinData(mintStr: string): Promise<CoinData | null> {
    try {
      const response = await axios.get(`/api/pump-proxy?mintAddress=${mintStr}`);

      if (response.status === 200) {
        const data = response.data;
        return {
          mint: mintStr,
          name: data.name,
          symbol: data.symbol,
          virtualTokenReserves: data.virtual_token_reserves,
          virtualSolReserves: data.virtual_sol_reserves,
          bondingCurve: data.bonding_curve,
          associatedBondingCurve: data.associated_bonding_curve,
          tokenTotalSupply: data.total_supply,
          complete: data.complete,
          usdMarketCap: data.usd_market_cap,
          marketCap: data.market_cap,
          creator: data.creator,
          createdTimestamp: data.created_timestamp
        };
      }
      return null;
    } catch (error) {
      console.error('Error fetching coin data:', error);
      return null;
    }
  }

  private async createBuyInstruction(
    owner: PublicKey,
    mint: PublicKey,
    amount: number,
    coinData: CoinData,
    slippageDecimal: number
  ): Promise<{ transaction: Transaction; tokenAccount: PublicKey }> {
    // Get latest blockhash first
    const blockhashResponse = await axios.post(this.rpcEndpoint, {
      method: 'getLatestBlockhash',
      jsonrpc: '2.0',
      params: [{ commitment: 'confirmed' }],
      id: this.getNextRequestId()
    }, { headers: COMMON_HEADERS });

    const blockhash = blockhashResponse.data.result.value.blockhash;
    
    const txBuilder = new Transaction();
    txBuilder.recentBlockhash = blockhash;
    txBuilder.feePayer = owner;

    // Add compute budget instructions first
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ 
      units: COMPUTE_UNIT_LIMIT
    });
    
    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: PRIORITY_RATE
    });
    
    txBuilder.add(computeBudgetIx);
    txBuilder.add(priorityFeeIx);

    // Get or create token account
    const tokenAccountAddress = getAssociatedTokenAddressSync(mint, owner, false);
    const tokenAccountInfo = await this.connection.getAccountInfo(tokenAccountAddress);

    if (!tokenAccountInfo) {
      txBuilder.add(
        createAssociatedTokenAccountInstruction(
          owner,
          tokenAccountAddress,
          owner,
          mint
        )
      );
    }

    // Calculate amounts
    const solInLamports = amount * LAMPORTS_PER_SOL;
    const tokenOut = Math.floor((solInLamports * coinData.virtualTokenReserves) / coinData.virtualSolReserves);
    const maxSolCost = Math.floor(solInLamports * (1 + slippageDecimal));

    // Create buy instruction with correct account ordering from IDL
    const keys = [
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(coinData.bondingCurve), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(coinData.associatedBondingCurve), isSigner: false, isWritable: true },
      { pubkey: tokenAccountAddress, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: RENT, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false }
    ];

    // Create instruction data with proper discriminator and amounts
    const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]); // buy instruction discriminator from Python
    const data = Buffer.concat([
      discriminator,
      bufferFromUInt64(tokenOut),
      bufferFromUInt64(maxSolCost)
    ]);

    const instruction = new TransactionInstruction({
      keys,
      programId: PUMP_FUN_PROGRAM,
      data
    });

    txBuilder.add(instruction);

    return { transaction: txBuilder, tokenAccount: tokenAccountAddress };
  }

  private async createSellInstruction(
    owner: PublicKey,
    mint: PublicKey,
    percentage: number,  
    coinData: CoinData,
    slippageDecimal: number
  ): Promise<{ transaction: Transaction; tokenAccount: PublicKey }> {
    const blockhashResponse = await axios.post(this.rpcEndpoint, {
      method: 'getLatestBlockhash',
      jsonrpc: '2.0',
      params: [{ commitment: 'confirmed' }],
      id: this.getNextRequestId()
    }, { headers: COMMON_HEADERS });

    const blockhash = blockhashResponse.data.result.value.blockhash;
    
    const txBuilder = new Transaction();
    txBuilder.recentBlockhash = blockhash;
    txBuilder.feePayer = owner;

    txBuilder.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }));
    txBuilder.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_RATE }));

    const tokenAccountAddress = getAssociatedTokenAddressSync(mint, owner, false);

    // Get token account info to get actual token balance
    const tokenAccountInfo = await this.connection.getTokenAccountBalance(tokenAccountAddress);
    if (!tokenAccountInfo?.value) {
      throw new Error('Could not fetch token account balance');
    }

    // Calculate the actual token amount from the percentage using the real balance
    const actualBalance = tokenAccountInfo.value.amount;
    const amountInUnits = Math.floor((Number(actualBalance) * percentage) / 100);
    
    const expectedSolOutput = Math.floor(
      (amountInUnits * coinData.virtualSolReserves) / coinData.virtualTokenReserves
    );
    const minSolOutput = Math.floor(expectedSolOutput * (1 - slippageDecimal));

    // Create sell instruction with correct account ordering from IDL
    const keys = [
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(coinData.bondingCurve), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(coinData.associatedBondingCurve), isSigner: false, isWritable: true },
      { pubkey: tokenAccountAddress, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false }
    ];

    // Create instruction data with proper discriminator and amounts
    const discriminator = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]); // sell instruction discriminator from Python
    const data = Buffer.concat([
      discriminator,
      bufferFromUInt64(amountInUnits),
      bufferFromUInt64(minSolOutput)
    ]);

    const instruction = new TransactionInstruction({
      keys,
      programId: PUMP_FUN_PROGRAM,
      data
    });

    txBuilder.add(instruction);

    return { transaction: txBuilder, tokenAccount: tokenAccountAddress };
  }

  async sendAndConfirmTransaction(transaction: Transaction): Promise<string> {
    try {
      // Step 1: Get fresh blockhash and sign transaction
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.sign(this.payer);
      
      // Step 2: Send the transaction
      const signature = await this.connection.sendTransaction(transaction, [this.payer], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3
      });

      // Step 3: Wait for confirmation with timeout
      let done = false;
      let status: any = null;
      
      const startTime = Date.now();
      while (!done && Date.now() - startTime < 30000) {
        try {
          status = await this.connection.getSignatureStatus(signature);
          
          if (status?.value) {
            if (status.value.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
            }
            
            if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
              done = true;
              break;
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          if (Date.now() - startTime > 30000) {
            throw new Error('Transaction confirmation timeout');
          }
          console.warn('Retrying confirmation:', err);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!done) {
        throw new Error('Transaction confirmation timeout');
      }

      return signature;
    } catch (error) {
      console.error('Error in transaction handling:', error);
      throw error;
    }
  }

  public shouldBuyToken(coinData: any, twitterData: any): boolean {
    // If no trading settings exist, allow the buy (this is a manual buy)
    if (!this.tradingSettings) {
      return true;
    }

    // If this is a manual buy (no twitterData), allow it
    if (!twitterData) {
      return true;
    }

    // From this point on, we're dealing with autobuy

    // First check if autobuy is enabled
    if (!this.tradingSettings.autoBuyEnabled) {
      console.log('Autobuy is disabled');
      return false;
    }

    // If both checks are turned off, no autobuys should happen
    if (!this.tradingSettings.followerCheckEnabled && !this.tradingSettings.creationTimeEnabled) {
      console.log('Both follower and age checks are disabled - no autobuys will occur');
      return false;
    }

    let followerCheckPassed = false;
    let ageCheckPassed = false;

    // Check followers if enabled
    if (this.tradingSettings.followerCheckEnabled) {
      const followerCount = twitterData.user?.followers_count || 0;
      followerCheckPassed = followerCount >= this.tradingSettings.minFollowers;
      console.log(`Follower check ${followerCheckPassed ? 'passed' : 'failed'}: ${followerCount} ${followerCheckPassed ? '>=' : '<'} ${this.tradingSettings.minFollowers}`);
    }

    // Check age if enabled
    if (this.tradingSettings.creationTimeEnabled && coinData.createdTimestamp) {
      const tokenAge = (Date.now() / 1000) - coinData.createdTimestamp;
      const maxAgeInSeconds = this.tradingSettings.maxCreationTime * 60;
      ageCheckPassed = tokenAge <= maxAgeInSeconds;
      console.log(`Age check ${ageCheckPassed ? 'passed' : 'failed'}: ${Math.round(tokenAge / 60)} minutes ${ageCheckPassed ? '<=' : '>'} ${this.tradingSettings.maxCreationTime}`);
    }

    // If both checks are enabled, both must pass
    if (this.tradingSettings.followerCheckEnabled && this.tradingSettings.creationTimeEnabled) {
      const shouldBuy = followerCheckPassed && ageCheckPassed;
      console.log(`Both checks enabled: follower check ${followerCheckPassed}, age check ${ageCheckPassed} - ${shouldBuy ? 'buying' : 'not buying'}`);
      return shouldBuy;
    }

    // If only follower check is enabled
    if (this.tradingSettings.followerCheckEnabled) {
      console.log(`Only follower check enabled: ${followerCheckPassed ? 'buying' : 'not buying'}`);
      return followerCheckPassed;
    }

    // If only age check is enabled
    if (this.tradingSettings.creationTimeEnabled) {
      console.log(`Only age check enabled: ${ageCheckPassed ? 'buying' : 'not buying'}`);
      return ageCheckPassed;
    }

    // This line should never be reached due to earlier checks
    return false;
  }

  async buy(
    mintAddress: string,
    amountInSol: number,
    slippage: number = 0.25 // 25% default slippage
  ): Promise<string | null> {
    try {
      const slippageDecimal = slippage / 100;
      const coinData = await this.getCoinData(mintAddress);
      if (!coinData) {
        throw new Error("Failed to fetch coin data");
      }

      if (!this.shouldBuyToken(coinData, null)) {
        console.log('Skipping buy due to trading settings');
        return null;
      }

      const { transaction } = await this.createBuyInstruction(
        this.payer.publicKey,
        new PublicKey(mintAddress),
        amountInSol,
        coinData,
        slippageDecimal
      );

      return await this.sendAndConfirmTransaction(transaction);
    } catch (error) {
      console.error('Error in buy transaction:', error);
      throw error;
    }
  }

  async sell(
    mintAddress: string,
    percentage: number,
    slippagePercent: number = 25
  ): Promise<string | null> {
    try {
      const slippageDecimal = slippagePercent / 100;
      const coinData = await this.getCoinData(mintAddress);
      if (!coinData) {
        throw new Error("Failed to retrieve coin data");
      }

      const { transaction } = await this.createSellInstruction(
        this.payer.publicKey,
        new PublicKey(mintAddress),
        percentage,
        coinData,
        slippageDecimal
      );

      return await this.sendAndConfirmTransaction(transaction);
    } catch (error) {
      console.error('Error in sell transaction:', error);
      return null;
    }
  }

  public async getTokenPrice(mint: string): Promise<number | null> {
    try {
      const coinData = await this.getCoinData(mint);
      if (!coinData) {
        throw new Error('Failed to fetch coin data');
      }

      if (coinData.virtualTokenReserves === 0) return 0;
      
      // Convert total supply to proper decimal value (divide by 10^6 for 6 decimal tokens)
      const adjustedTotalSupply = coinData.tokenTotalSupply / TOKEN_DECIMALS;
      
      // Calculate USD price per token
      const usdPrice = coinData.usdMarketCap / adjustedTotalSupply;
      return usdPrice;
    } catch (error) {
      console.error('Error in getTokenPrice:', error);
      return null;
    }
  }

  public async autoBuy(
    mintAddress: string,
    twitterData: any = null
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      // Check if enough time has passed since last buy
      const now = Date.now();
      if (now - this.lastBuyTimestamp < this.MIN_BUY_INTERVAL) {
        return { 
          success: false, 
          error: 'Rate limit: Too soon since last buy attempt' 
        };
      }

      // Check and update buy attempts for this token
      const buyAttempt = this.buyAttempts.get(mintAddress) || { timestamp: 0, count: 0 };
      if (now - buyAttempt.timestamp > this.BUY_ATTEMPT_WINDOW) {
        // Reset if window has expired
        buyAttempt.timestamp = now;
        buyAttempt.count = 1;
      } else if (buyAttempt.count >= this.MAX_BUY_ATTEMPTS) {
        return { 
          success: false, 
          error: `Max buy attempts (${this.MAX_BUY_ATTEMPTS}) reached for this token` 
        };
      } else {
        buyAttempt.count++;
      }
      this.buyAttempts.set(mintAddress, buyAttempt);

      // Get coin data and check if it meets criteria
      const coinData = await this.getCoinData(mintAddress);
      if (!coinData) {
        return { 
          success: false, 
          error: 'Failed to fetch coin data' 
        };
      }

      if (!this.shouldBuyToken(coinData, twitterData)) {
        return { 
          success: false, 
          error: 'Token does not meet buying criteria' 
        };
      }

      // Update last buy timestamp before attempting purchase
      this.lastBuyTimestamp = now;

      // Attempt to buy using settings from trading context
      const signature = await this.buy(
        mintAddress,
        this.tradingSettings.buyAmount,
        this.tradingSettings.slippage
      );

      if (!signature) {
        return { 
          success: false, 
          error: 'Buy transaction failed' 
        };
      }

      return { 
        success: true, 
        signature 
      };

    } catch (error) {
      console.error('Error in autoBuy:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error in autoBuy' 
      };
    }
  }
}

export { PumpFunClient };

function bufferFromUInt64(value: number | string) {
  let buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value.toString()));
  return buffer;
}
