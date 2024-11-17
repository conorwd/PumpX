'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useTradingContext } from '@/context/TradingContext';
import { useBlacklist } from '@/context/BlacklistContext';
import { useBuylist } from '@/context/BuylistContext';
import { useState, useEffect } from 'react';
import { Tooltip as ReactTooltip } from 'react-tooltip';
import toast from 'react-hot-toast';
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import PurchasedTokens from './PurchasedTokens';
import OrderStatus from './OrderStatus';

export default function TradingSettings() {
  const {
    privateKey,
    setPrivateKey,
    minFollowers,
    setMinFollowers,
    autoBuyEnabled,
    setAutoBuyEnabled,
    buyAmount,
    setBuyAmount,
    slippage,
    setSlippage,
    followerCheckEnabled,
    setFollowerCheckEnabled,
  } = useTradingContext();

  const { blacklistedUsers, addToBlacklist, removeFromBlacklist } = useBlacklist();
  const { buylistedUsers, addToBuylist, removeFromBuylist } = useBuylist();

  const [mounted, setMounted] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('trading');
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newBlacklistUser, setNewBlacklistUser] = useState('');
  const [newBuylistUser, setNewBuylistUser] = useState('');

  // Initialize Solana connection
  const connection = new Connection(process.env.NEXT_PUBLIC_HELIUS_RPC_URL || '');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (privateKey) {
      try {
        const decodedKey = bs58.decode(privateKey);
        const keypair = Keypair.fromSecretKey(decodedKey);
        setPublicKey(keypair.publicKey.toString());
        updateBalance(keypair.publicKey.toString());
      } catch (err) {
        console.error('Error deriving public key:', err);
        setPublicKey(null);
      }
    } else {
      setPublicKey(null);
      setSolBalance(null);
    }
  }, [privateKey]);

  const updateBalance = async (address: string) => {
    try {
      const pubKey = new PublicKey(address);
      const balance = await connection.getBalance(pubKey);
      setSolBalance(balance / LAMPORTS_PER_SOL); // Convert lamports to SOL
    } catch (err) {
      console.error('Error fetching balance:', err);
      setSolBalance(null);
    }
  };

  const handlePrivateKeyChange = (value: string) => {
    try {
      // Validate the private key format
      bs58.decode(value);
      setPrivateKey(value);
      setError(null);
    } catch (err) {
      setError('Invalid private key format');
    }
  };

  const handleGenerateWallet = () => {
    try {
      // Generate 32 bytes of random values for the seed
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      
      // Create keypair from the random seed
      const newKeypair = Keypair.fromSeed(randomBytes);
      const newPrivateKey = bs58.encode(newKeypair.secretKey);
      const newPublicKey = newKeypair.publicKey.toString();
      
      // Create and download private key file
      const content = `Private Key: ${newPrivateKey}\nPublic Key: ${newPublicKey}\n\nIMPORTANT: Keep this file secure and never share your private key with anyone!`;
      const blob = new Blob([content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `solana-wallet-${newPublicKey.slice(0, 8)}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      setPrivateKey(newPrivateKey);
      setError(null);
      toast.success('New wallet generated and private key downloaded');
    } catch (err) {
      console.error('Failed to generate wallet:', err);
      setError('Failed to generate new wallet');
      toast.error('Failed to generate new wallet');
    }
  };

  const handleImportClick = () => {
    if (!isImporting) {
      // First click - clear current wallet and enter import mode
      setPrivateKey('');
      setPublicKey('');
      setSolBalance(null);
      setIsImporting(true);
    } else {
      // Second click - confirm import
      if (privateKey) {
        try {
          handlePrivateKeyChange(privateKey);
          toast.success('Wallet imported successfully');
          setIsImporting(false);
        } catch (err) {
          toast.error('Invalid private key');
        }
      } else {
        setError('Please enter a private key');
      }
    }
  };

  const handleBuyAmountChange = (value: number) => {
    if (value >= 0) {
      setBuyAmount(value);
    }
  };

  const handleSlippageChange = (value: number) => {
    if (value >= 0.1 && value <= 100) {
      setSlippage(value);
    }
  };

  if (!mounted) return null;

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 h-[calc(100vh-12rem)] shadow-xl">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Trading Settings</h2>
          <div className="flex items-center space-x-3">
            <span className="text-sm text-gray-400">Auto Trading</span>
            <button
              onClick={() => setAutoBuyEnabled(!autoBuyEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-500/50 ${
                autoBuyEnabled ? 'bg-yellow-500' : 'bg-gray-700'
              }`}
              data-tooltip-id="auto-buy-tooltip"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoBuyEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <ReactTooltip
              id="auto-buy-tooltip"
              content={autoBuyEnabled ? "Auto trading enabled" : "Auto trading disabled"}
              place="top"
            />
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 border-b border-gray-800">
          {['trading', 'holdings', 'wallet', 'blacklist', 'buylist'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab
                  ? 'text-yellow-500 bg-gray-800 border-t border-l border-r border-gray-700'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>
      
      {/* Content */}
      <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-20rem)]">
        {error && (
          <div className="text-red-400 text-sm p-3 bg-red-900/20 rounded-lg border border-red-900/50 flex items-center space-x-2">
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {activeTab === 'trading' && (
          <div className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-300">Minimum Followers</label>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-300">Check Followers</label>
                    <div
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out cursor-pointer ${
                        followerCheckEnabled ? 'bg-yellow-500' : 'bg-gray-600'
                      }`}
                      onClick={() => setFollowerCheckEnabled(!followerCheckEnabled)}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ease-in-out ${
                          followerCheckEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </div>
                  </div>
                </div>
                <input
                  type="number"
                  value={minFollowers}
                  onChange={(e) => setMinFollowers(Number(e.target.value))}
                  className={`w-full rounded-lg bg-black/20 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none ring-1 ring-white/10 transition-opacity focus:ring-yellow-500/50 ${
                    !followerCheckEnabled ? 'opacity-50' : ''
                  }`}
                  disabled={!followerCheckEnabled}
                  min="0"
                  step="100"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">Buy Amount (SOL)</label>
                <div className="flex gap-2 mb-2">
                  {[0.01, 0.1, 1, 10].map((value) => (
                    <button
                      key={value}
                      onClick={() => handleBuyAmountChange(value)}
                      className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                        buyAmount === value
                          ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/20'
                          : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700'
                      }`}
                    >
                      {value} SOL
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={buyAmount}
                  onChange={(e) => handleBuyAmountChange(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500 text-white"
                  min="0"
                  step="0.1"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">Slippage (%)</label>
                <div className="flex gap-2 mb-2">
                  {[1, 2.5, 10, 25].map((value) => (
                    <button
                      key={value}
                      onClick={() => handleSlippageChange(value)}
                      className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                        slippage === value
                          ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/20'
                          : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700'
                      }`}
                    >
                      {value}%
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={slippage}
                  onChange={(e) => handleSlippageChange(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500 text-white"
                  min="0.1"
                  max="100"
                  step="0.1"
                />
              </div>
            </div>

            <div className="border-t border-gray-800 pt-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Recent Orders</h3>
              <OrderStatus />
            </div>
          </div>
        )}

        {activeTab === 'wallet' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column - Private Key and Actions */}
              <div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Private Key</label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={privateKey || ''}
                      onChange={(e) => handlePrivateKeyChange(e.target.value)}
                      className="w-full px-3 py-1.5 bg-gray-800 rounded-lg border border-gray-700 focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500 text-white pr-10 text-sm"
                      placeholder="Enter your private key"
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="absolute inset-y-0 right-0 px-2 flex items-center text-gray-400 hover:text-white"
                    >
                      {showKey ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center space-x-2 mt-2">
                  <button
                    onClick={handleGenerateWallet}
                    className="flex-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition-colors border border-gray-700"
                    disabled={isImporting}
                  >
                    Generate New
                  </button>
                  <button
                    onClick={handleImportClick}
                    className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border ${
                      isImporting 
                        ? 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 border-yellow-500/50' 
                        : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700'
                    }`}
                  >
                    {isImporting ? 'Confirm Import' : 'Import'}
                  </button>
                </div>
              </div>

              {/* Right Column - Wallet Info */}
              <div className="space-y-3 bg-gray-800/50 p-3 rounded-lg">
                {publicKey ? (
                  <>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-400">SOL Balance</label>
                      <div className="text-lg font-semibold text-white">
                        {solBalance !== null ? `${solBalance.toFixed(4)} SOL` : 'Loading...'}
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-400">Public Key</label>
                      <div className="flex items-center space-x-2">
                        <div className="text-xs text-gray-300 truncate flex-1 font-mono">
                          {publicKey}
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(publicKey);
                            toast.success('Address copied to clipboard');
                          }}
                          className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div>
                      <QRCodeSVG
                        value={publicKey}
                        size={100}
                        level="M"
                        className="mx-auto bg-white p-1.5 rounded-lg"
                      />
                    </div>
                  </>
                ) : (
                  <div className="text-gray-400 text-xs text-center py-3">
                    {isImporting 
                      ? 'Paste your private key above and click Confirm Import'
                      : 'Import or generate a wallet to view details'
                    }
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'holdings' && (
          <PurchasedTokens />
        )}

        {activeTab === 'blacklist' && (
          <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-4 max-h-[calc(100vh-16rem)] flex flex-col">
            <h3 className="text-lg font-semibold">Blacklist Management</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Enter Twitter username"
                className="flex-1 rounded-lg bg-black/20 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none ring-1 ring-white/10 transition-shadow focus:ring-yellow-500/50"
              />
              <button
                onClick={() => {
                  if (newUsername.trim()) {
                    addToBlacklist(newUsername.trim());
                    setNewUsername('');
                  }
                }}
                className="rounded-lg bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-500 transition-colors hover:bg-yellow-500/20"
              >
                Add
              </button>
            </div>
            
            {/* Blacklisted Users List */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="space-y-2">
                {blacklistedUsers.map((username) => (
                  <div key={username} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                    <span className="text-sm text-gray-300">@{username}</span>
                    <button
                      onClick={() => removeFromBlacklist(username)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {blacklistedUsers.length === 0 && (
                  <p className="text-sm text-gray-500">No blacklisted users</p>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'buylist' && (
          <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-4 max-h-[calc(100vh-16rem)] flex flex-col">
            <h3 className="text-lg font-semibold">Buylist Management</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newBuylistUser}
                onChange={(e) => setNewBuylistUser(e.target.value)}
                placeholder="Enter Twitter username"
                className="flex-1 rounded-lg bg-black/20 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none ring-1 ring-white/10 transition-shadow focus:ring-yellow-500/50"
              />
              <button
                onClick={() => {
                  if (newBuylistUser.trim()) {
                    addToBuylist(newBuylistUser.trim());
                    setNewBuylistUser('');
                  }
                }}
                className="rounded-lg bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-500 transition-colors hover:bg-yellow-500/20"
              >
                Add
              </button>
            </div>
            
            {/* Buylisted Users List */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="space-y-2">
                {buylistedUsers.map((username) => (
                  <div key={username} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                    <span className="text-sm text-gray-300">@{username}</span>
                    <button
                      onClick={() => removeFromBuylist(username)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {buylistedUsers.length === 0 && (
                  <p className="text-sm text-gray-500">No buylisted users</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
