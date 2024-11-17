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

  constructor(connection: Connection, payer: Keypair, rpcEndpoint?: string) {
    this.connection = connection;
    this.payer = payer;
    this.rpcEndpoint = rpcEndpoint || process.env.NEXT_PUBLIC_HELIUS_RPC_URL || '';
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
    amount: number,
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

    // Calculate amounts for sell
    const amountInUnits = Math.floor(amount * TOKEN_DECIMALS);
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
      // Step 1: Simulate the transaction
      const serializedTx = transaction.serialize({ verifySignatures: false }).toString('base64');
      const simulateResponse = await axios.post(this.rpcEndpoint, {
        method: 'simulateTransaction',
        jsonrpc: '2.0',
        params: [serializedTx, {
          sigVerify: false,
          replaceRecentBlockhash: true,
          encoding: 'base64',
          commitment: 'confirmed'
        }],
        id: this.getNextRequestId()
      }, { headers: COMMON_HEADERS });

      if (simulateResponse.data.result.value.err) {
        throw new Error(`Transaction simulation failed: ${JSON.stringify(simulateResponse.data.result.value.err)}`);
      }

      // Step 2: Get priority fee estimate
      const priorityFeeResponse = await axios.post(this.rpcEndpoint, {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'getPriorityFeeEstimate',
        params: [{
          transaction: serializedTx,
          options: {
            priorityLevel: 'High'
          }
        }]
      }, { headers: COMMON_HEADERS });

      // Step 3: Sign and send the transaction
      transaction.sign(this.payer);
      
      const txResponse = await axios.post(this.rpcEndpoint, {
        method: 'sendTransaction',
        jsonrpc: '2.0',
        params: [
          transaction.serialize().toString('base64'),
          { encoding: 'base64', preflightCommitment: 'confirmed' }
        ],
        id: this.getNextRequestId()
      }, { headers: COMMON_HEADERS });

      const signature = txResponse.data.result;

      // Step 4: Confirm transaction
      const confirmation = await this.connection.confirmTransaction({
        signature,
        blockhash: transaction.recentBlockhash!,
        lastValidBlockHeight: await this.connection.getBlockHeight()
      });

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      return signature;
    } catch (error) {
      console.error('Error in transaction handling:', error);
      throw error;
    }
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
    amount: number,
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
        amount,
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
      const solPrice = coinData.virtualSolReserves / coinData.virtualTokenReserves;
      const usdPrice = coinData.usdMarketCap / (coinData.tokenTotalSupply / 1e9);
      return usdPrice;
    } catch (error) {
      console.error('Error in getTokenPrice:', error);
      return null;
    }
  }
}

export { PumpFunClient };

function bufferFromUInt64(value: number | string) {
  let buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value.toString()));
  return buffer;
}
