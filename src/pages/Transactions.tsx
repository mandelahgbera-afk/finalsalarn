import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { OutletContext } from '@/lib/auth';
import { motion } from 'framer-motion';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Clock, CheckCircle, XCircle, X, Copy, KeyRound, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { toast } from 'sonner';

const TYPE_META: Record<string, any> = {
  deposit: { label: 'Deposit', icon: ArrowDownLeft, color: 'text-up bg-up' },
  withdrawal: { label: 'Withdrawal', icon: ArrowUpRight, color: 'text-down bg-down' },
  buy: { label: 'Buy', icon: ArrowLeftRight, color: 'text-blue-400 bg-blue-400/10' },
  sell: { label: 'Sell', icon: ArrowLeftRight, color: 'text-purple-400 bg-purple-400/10' },
  copy_profit: { label: 'Copy Profit', icon: ArrowDownLeft, color: 'text-up bg-up' },
};

const STATUS_META: Record<string, any> = {
  pending: { label: 'Pending', icon: Clock, cls: 'text-yellow-400 bg-yellow-400/10' },
  approved: { label: 'Approved', icon: CheckCircle, cls: 'text-up bg-up' },
  completed: { label: 'Completed', icon: CheckCircle, cls: 'text-up bg-up' },
  rejected: { label: 'Rejected', icon: XCircle, cls: 'text-down bg-down' },
};

const DEPOSIT_NETWORKS = [
  { key: 'btc',        label: 'Bitcoin (BTC)',  settingKey: 'deposit_address_btc' },
  { key: 'eth',        label: 'Ethereum (ETH)', settingKey: 'deposit_address_eth' },
  { key: 'usdt_trc20', label: 'USDT (TRC20)',   settingKey: 'deposit_address_usdt_trc20' },
  { key: 'usdt_erc20', label: 'USDT (ERC20)',   settingKey: 'deposit_address_usdt_erc20' },
  { key: 'bnb',        label: 'BNB',            settingKey: 'deposit_address_bnb' },
];

export default function Transactions() {
  const { user } = useOutletContext<OutletContext>();
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState<null | 'deposit' | 'withdrawal' | 'otp'>(null);
  const [amount, setAmount] = useState('');
  const [wallet, setWallet] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [depositAddresses, setDepositAddresses] = useState<Record<string, string>>({});
  const [selectedNetwork, setSelectedNetwork] = useState('btc');
  const [otpTxId, setOtpTxId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [savedWallet, setSavedWallet] = useState('');
  const [depositStep, setDepositStep] = useState<'address' | 'submit'>('address');
  const [depositAmount, setDepositAmount] = useState('');

  useEffect(() => {
    api.platformSettings.list().then(rows => {
      const map: Record<string, string> = {};
      rows.forEach((r: any) => { map[r.key] = r.value; });
      setDepositAddresses(map);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.id) {
      api.users.getById(user.id).then(data => {
        if (data?.wallet_address) setSavedWallet(data.wallet_address);
      }).catch(() => {});
    }
  }, [user?.id]);

  const load = useCallback(() => {
    if (!user?.email) return;
    api.transactions.getByEmail(user.email, 50)
      .then(t => { setTxns(t); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user?.email]);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'all' ? txns : txns.filter(t => t.type === filter);

  const handleWithdrawalSubmit = async () => {
    if (!user) return;
    if (!amount || parseFloat(amount) <= 0) { toast.error('Enter a valid amount'); return; }
    if (!wallet) { toast.error('Enter your wallet address'); return; }
    setSubmitting(true);
    try {
      await api.transactions.create({
        user_email: user.email,
        type: 'withdrawal',
        amount: parseFloat(amount),
        wallet_address: wallet,
        status: 'pending',
      });
      toast.success('Withdrawal request submitted! Once approved by admin, you will receive an OTP to confirm.');
      setModal(null); setAmount(''); setWallet('');
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Request failed');
    }
    setSubmitting(false);
  };

  const openOtp = (txId: string) => {
    setOtpTxId(txId);
    setOtpCode('');
    setModal('otp');
  };

  const handleVerifyOtp = async () => {
    if (!otpTxId || otpCode.length !== 6) { toast.error('Enter the 6-digit OTP'); return; }
    setOtpVerifying(true);
    try {
      await api.transactions.verifyOtp(otpTxId, otpCode);
      toast.success('Withdrawal confirmed! Your request is now being processed.');
      setModal(null); setOtpTxId(null); setOtpCode('');
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Invalid OTP');
    }
    setOtpVerifying(false);
  };

  const currentAddress = depositAddresses[DEPOSIT_NETWORKS.find(n => n.key === selectedNetwork)?.settingKey || ''];

  const pendingWithdrawalWithOtp = txns.find(
    t => t.type === 'withdrawal' && t.status === 'approved' && t.otp_code && !t.otp_verified
  );

  return (
    <div className="space-y-6">
      <PageHeader user={user} title="Transactions" subtitle="Deposits, withdrawals & history" />

      {pendingWithdrawalWithOtp && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-4 px-5 py-4 bg-yellow-500/10 border border-yellow-500/25 rounded-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <KeyRound className="w-5 h-5 text-yellow-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-yellow-300">OTP Required for Withdrawal</p>
              <p className="text-xs text-yellow-300/70">Your withdrawal of ${pendingWithdrawalWithOtp.amount?.toLocaleString()} has been approved. Enter your OTP to confirm.</p>
            </div>
          </div>
          <Button onClick={() => openOtp(pendingWithdrawalWithOtp.id)}
            className="flex-shrink-0 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-xs h-9 px-4">
            Enter OTP
          </Button>
        </motion.div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {['all', 'deposit', 'withdrawal', 'buy', 'sell', 'copy_profit'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${filter === f ? 'bg-primary/15 text-primary border border-primary/25' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
              {f === 'copy_profit' ? 'Copy Profit' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { setModal('deposit'); }}
            className="gradient-green text-white font-semibold text-xs h-9 px-4 glow-green-xs">
            + Deposit
          </Button>
          <Button onClick={() => { setModal('withdrawal'); setAmount(''); setWallet(savedWallet); }}
            variant="outline" className="border-border text-xs h-9 px-4">
            Withdraw
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="hidden sm:grid grid-cols-5 text-xs text-muted-foreground px-5 py-3 border-b border-border/60 font-medium">
          <span>Type</span>
          <span>Amount</span>
          <span>Date</span>
          <span>Status</span>
          <span>Action</span>
        </div>
        {loading ? (
          <div className="space-y-px">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 shimmer" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <ArrowLeftRight className="w-8 h-8 opacity-30" />
            <p className="text-sm">No {filter === 'all' ? '' : filter} transactions yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filtered.map(tx => {
              const meta = TYPE_META[tx.type];
              const statusMeta = STATUS_META[tx.status];
              const Icon = meta?.icon || ArrowLeftRight;
              const StatusIcon = statusMeta?.icon || Clock;
              const isIn = ['deposit', 'sell', 'copy_profit'].includes(tx.type);
              const needsOtp = tx.type === 'withdrawal' && tx.status === 'approved' && tx.otp_code && !tx.otp_verified;

              return (
                <div key={tx.id}
                  className="grid grid-cols-1 sm:grid-cols-5 items-center gap-3 px-5 py-4 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 ${meta?.color || 'bg-secondary text-muted-foreground'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{meta?.label || tx.type}</p>
                      {tx.crypto_symbol && (
                        <p className="text-[10px] text-muted-foreground">{tx.crypto_symbol}</p>
                      )}
                    </div>
                  </div>

                  <p className={`text-sm font-mono font-bold tabular-nums ${isIn ? 'text-up' : 'text-down'}`}>
                    {isIn ? '+' : '-'}${Math.abs(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    {new Date(tx.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>

                  <div className="flex items-center gap-1.5">
                    <StatusIcon className={`w-3.5 h-3.5 ${statusMeta?.cls?.split(' ')[0] || 'text-muted-foreground'}`} />
                    <span className={`text-xs font-semibold capitalize ${statusMeta?.cls?.split(' ')[0] || 'text-muted-foreground'}`}>
                      {statusMeta?.label || tx.status}
                    </span>
                  </div>

                  <div>
                    {needsOtp ? (
                      <button onClick={() => openOtp(tx.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-yellow-500/15 border border-yellow-500/30 text-yellow-300 text-xs font-semibold hover:bg-yellow-500/25 transition-colors">
                        <KeyRound className="w-3.5 h-3.5" />
                        Enter OTP
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Deposit Modal ── */}
      {modal === 'deposit' && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-lg">Deposit Funds</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${depositStep === 'address' ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'}`}>1 Send</span>
                  <span className="text-muted-foreground text-[10px]">→</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${depositStep === 'submit' ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'}`}>2 Submit</span>
                </div>
              </div>
              <button onClick={() => { setModal(null); setDepositStep('address'); setDepositAmount(''); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {depositStep === 'address' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {DEPOSIT_NETWORKS.map(n => (
                    <button key={n.key} onClick={() => setSelectedNetwork(n.key)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${selectedNetwork === n.key ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                      {n.label}
                    </button>
                  ))}
                </div>

                {currentAddress ? (
                  <div className="bg-secondary rounded-xl p-4 space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">Send to this address:</p>
                    <div className="flex items-start gap-2">
                      <code className="text-xs font-mono text-foreground break-all flex-1 leading-relaxed">{currentAddress}</code>
                      <button
                        onClick={() => { navigator.clipboard.writeText(currentAddress); toast.success('Address copied!'); }}
                        className="text-muted-foreground hover:text-primary flex-shrink-0 mt-0.5">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-secondary rounded-xl p-4 text-xs text-muted-foreground text-center">
                    No address configured for this network yet. Contact support.
                  </div>
                )}

                <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/15 text-xs text-muted-foreground">
                  <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                  <p>Send your crypto to the address above, then click "I've Sent — Continue" to submit your deposit details for processing.</p>
                </div>

                <Button onClick={() => setDepositStep('submit')} disabled={!currentAddress}
                  className="w-full gradient-green text-white font-bold h-11 glow-green-xs">
                  I've Sent — Continue →
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="px-4 py-3 rounded-xl bg-up/8 border border-up/20 text-xs text-up space-y-1">
                  <p className="font-semibold">How this works:</p>
                  <p>Enter the USD value you sent. Once our team confirms your transaction on the blockchain, your balance will be credited within 1–24 hours.</p>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Amount Sent (USD equivalent) *</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value)}
                    className="bg-secondary border-border font-mono h-12 text-lg"
                    autoFocus
                  />
                </div>

                <div className="bg-secondary rounded-xl p-3 text-xs text-muted-foreground space-y-1">
                  <p><span className="font-medium text-foreground">Network:</span> {DEPOSIT_NETWORKS.find(n => n.key === selectedNetwork)?.label}</p>
                  {currentAddress && <p className="font-mono truncate"><span className="font-medium text-foreground not-italic">Address:</span> {currentAddress.slice(0, 20)}…</p>}
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setDepositStep('address')} className="border-border hover:bg-secondary h-11">
                    ← Back
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!user || !depositAmount || parseFloat(depositAmount) <= 0) { toast.error('Enter the amount you sent'); return; }
                      setSubmitting(true);
                      try {
                        await api.transactions.create({
                          user_email: user.email,
                          type: 'deposit',
                          amount: parseFloat(depositAmount),
                          status: 'pending',
                        });
                        toast.success('Deposit submitted! Your balance will be credited after confirmation.');
                        setModal(null); setDepositStep('address'); setDepositAmount('');
                        load();
                      } catch (e: unknown) {
                        toast.error(e instanceof Error ? e.message : 'Submission failed');
                      }
                      setSubmitting(false);
                    }}
                    disabled={submitting}
                    className="flex-1 gradient-green text-white font-bold h-11 glow-green-xs">
                    {submitting ? 'Submitting...' : 'Submit Deposit'}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* ── Withdrawal Modal ── */}
      {modal === 'withdrawal' && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">Request Withdrawal</h3>
              <button onClick={() => { setModal(null); setAmount(''); setWallet(''); }}
                className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="px-4 py-3 rounded-xl bg-blue-500/8 border border-blue-500/20 text-xs text-blue-300 space-y-1">
                <p className="font-semibold">How withdrawals work:</p>
                <p>1. Submit this form with your amount and wallet address.</p>
                <p>2. Admin reviews and approves your request.</p>
                <p>3. You receive a one-time OTP — enter it here to confirm.</p>
                <p>4. Funds are sent to your wallet within 24–48h.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Withdrawal Amount (USD)</label>
                <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}
                  className="bg-secondary border-border font-mono" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-muted-foreground">Your Wallet Address</label>
                  {savedWallet && wallet !== savedWallet && (
                    <button onClick={() => setWallet(savedWallet)} className="text-xs text-primary hover:underline">
                      Use saved address
                    </button>
                  )}
                </div>
                <Input placeholder="0x... or bc1q..." value={wallet} onChange={e => setWallet(e.target.value)}
                  className="bg-secondary border-border font-mono text-xs" />
                {!savedWallet && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Save a default wallet in{' '}
                    <a href="/settings" className="text-primary hover:underline">Settings → Wallet Address</a>
                  </p>
                )}
              </div>
              <Button onClick={handleWithdrawalSubmit} disabled={submitting} variant="destructive" className="w-full h-11 font-bold">
                {submitting ? 'Submitting...' : 'Request Withdrawal'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── OTP Modal ── */}
      {modal === 'otp' && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-yellow-400" />
                Confirm Withdrawal
              </h3>
              <button onClick={() => { setModal(null); setOtpCode(''); setOtpTxId(null); }}
                className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-5">
              <div className="text-center px-4 py-5 bg-yellow-500/8 border border-yellow-500/20 rounded-2xl">
                <KeyRound className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-yellow-300 mb-1">Enter your 6-digit OTP</p>
                <p className="text-xs text-yellow-300/60">Your OTP was provided by the admin after approving your withdrawal. It expires in 15 minutes.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">One-Time Password (OTP)</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="bg-secondary border-border font-mono text-2xl text-center tracking-[0.5em] h-14"
                  autoFocus
                />
              </div>
              <Button
                onClick={handleVerifyOtp}
                disabled={otpVerifying || otpCode.length !== 6}
                className="w-full h-11 font-bold gradient-green text-white glow-green-xs">
                {otpVerifying ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Verifying...
                  </div>
                ) : 'Confirm Withdrawal'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
