import { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import type { OutletContext } from '@/lib/auth';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import {
  Wallet, TrendingUp, TrendingDown, ArrowDownLeft,
  ArrowUpRight, ArrowLeftRight, Copy, Eye, EyeOff,
  Sparkles, ChevronRight, BarChart2
} from 'lucide-react';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import PageHeader from '@/components/ui/PageHeader';
import { CoinIcon } from '@/components/ui/CryptoRow';

const QUICK_ACTIONS = [
  { label: 'Deposit',  icon: ArrowDownLeft,  path: '/transactions', gradient: 'from-emerald-500/20 to-teal-500/10',  border: 'border-emerald-500/20', iconColor: 'text-emerald-400' },
  { label: 'Withdraw', icon: ArrowUpRight,   path: '/transactions', gradient: 'from-blue-500/20 to-cyan-500/10',     border: 'border-blue-500/20',    iconColor: 'text-blue-400' },
  { label: 'Trade',    icon: ArrowLeftRight, path: '/trade',        gradient: 'from-purple-500/20 to-pink-500/10',   border: 'border-purple-500/20',  iconColor: 'text-purple-400' },
  { label: 'Copy',     icon: Copy,           path: '/copy-trading', gradient: 'from-yellow-500/20 to-orange-500/10', border: 'border-yellow-500/20',  iconColor: 'text-yellow-400' },
];

const PIE_COLORS = ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4'];

const PERIODS = [
  { label: '7D',  days: 7 },
  { label: '30D', days: 30 },
  { label: '3M',  days: 90 },
  { label: 'All', days: 0 },
];

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl px-4 py-3 border border-white/10 shadow-2xl"
      style={{ background: 'rgba(10,15,30,0.95)', backdropFilter: 'blur(16px)' }}>
      <p className="text-[10px] text-muted-foreground mb-1">{payload[0].payload.t}</p>
      <p className="font-mono font-black text-sm text-emerald-400">
        ${payload[0].value?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  );
}

function buildChartData(txns: any[], currentBalance: number, days: number) {
  if (!txns.length) return [];
  const cutoff = days > 0 ? new Date(Date.now() - days * 86400000) : new Date(0);
  const all = [...txns].filter(tx => days === 0 || new Date(tx.created_at) >= cutoff);
  const sorted = all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  let running = 0;
  const points: { t: string; v: number }[] = [];

  for (const tx of sorted) {
    if (tx.status === 'rejected') continue;
    const amt = Number(tx.amount) || 0;
    if (tx.type === 'deposit'     && (tx.status === 'approved' || tx.status === 'completed')) running += amt;
    else if (tx.type === 'withdrawal' && tx.status === 'completed')                          running -= amt;
    else if (tx.type === 'buy'    && (tx.status === 'approved' || tx.status === 'completed')) running -= amt;
    else if (tx.type === 'sell'   && (tx.status === 'approved' || tx.status === 'completed')) running += amt;
    else if (tx.type === 'copy_profit' && (tx.status === 'approved' || tx.status === 'completed')) running += amt;

    const d = new Date(tx.created_at);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    points.push({ t: label, v: Math.max(0, running) });
  }

  if (points.length > 0 && currentBalance > 0) {
    points[points.length - 1].v = currentBalance;
  }
  if (points.length === 1) {
    points.unshift({ t: 'Start', v: 0 });
  }

  return points;
}

const CustomDot = (props: any) => {
  const { cx, cy, index, data } = props;
  if (index !== (data?.length ?? 0) - 1) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill="rgba(16,185,129,0.2)" />
      <circle cx={cx} cy={cy} r={5} fill="#10b981" />
    </g>
  );
};

export default function Dashboard() {
  const { user } = useOutletContext<OutletContext>();
  const [balance, setBalance] = useState<any>(null);
  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [cryptos, setCryptos] = useState<any[]>([]);
  const [txns, setTxns] = useState<any[]>([]);
  const [allTxns, setAllTxns] = useState<any[]>([]);
  const [hideBalance, setHideBalance] = useState(false);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(3);

  const loadAll = useCallback(async () => {
    if (!user?.email) return;
    try {
      const [bal, port, cry, allTx] = await Promise.all([
        api.balances.getByEmail(user.email),
        api.portfolio.getByEmail(user.email),
        api.cryptos.active(),
        api.transactions.getByEmail(user.email, 500),
      ]);
      setBalance(bal || { balance_usd: 0, total_invested: 0, total_profit_loss: 0 });
      setPortfolio(port);
      setCryptos(cry);
      setTxns(allTx.slice(0, 5));
      setAllTxns(allTx);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!user?.email) return;
    const channel = supabase
      .channel(`user-dashboard-${user.email}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'user_balances', filter: `user_email=eq.${user.email}` },
        () => { loadAll(); }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `user_email=eq.${user.email}` },
        () => { loadAll(); }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'portfolio', filter: `user_email=eq.${user.email}` },
        () => { loadAll(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.email, loadAll]);

  const totalBalance = balance?.balance_usd || 0;
  const pl = balance?.total_profit_loss || 0;
  const plPct = balance?.total_invested > 0 ? ((pl / balance.total_invested) * 100).toFixed(2) : '0.00';
  const isUp = pl >= 0;
  const isNewUser = !loading && totalBalance === 0 && txns.length === 0 && portfolio.length === 0;

  const activeColor = isUp ? '#10b981' : '#ef4444';

  const portfolioWithPrices = portfolio.map((p, i) => {
    const crypto = cryptos.find(c => c.symbol === p.crypto_symbol);
    const currentValue = (crypto?.price || 0) * p.amount;
    return { ...p, currentValue, price: crypto?.price || 0, color: PIE_COLORS[i % PIE_COLORS.length] };
  });

  const totalPortfolioValue = portfolioWithPrices.reduce((s, p) => s + p.currentValue, 0);
  const pieData = portfolioWithPrices.map(p => ({ name: p.crypto_symbol, value: p.currentValue }));

  const selectedDays = PERIODS[period]?.days ?? 0;
  const chartData = useMemo(
    () => buildChartData(allTxns, totalBalance, selectedDays),
    [allTxns, totalBalance, selectedDays]
  );

  return (
    <div className="space-y-5">
      <PageHeader user={user} title="Dashboard" subtitle={`Welcome back, ${user?.full_name?.split(' ')[0] || 'Trader'}`} />

      {/* Balance Card */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="relative rounded-3xl p-6 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, hsl(222,40%,12%) 0%, hsl(222,40%,9%) 100%)',
          border: '1px solid rgba(16,185,129,0.18)',
          boxShadow: '0 0 60px rgba(16,185,129,0.06), inset 0 1px 0 rgba(255,255,255,0.05)'
        }}>
        <div className="absolute top-0 right-0 w-80 h-80 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 80% 20%, rgba(16,185,129,0.12), transparent 65%)' }} />
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                <Wallet className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <span className="text-sm text-muted-foreground font-medium">Total Balance</span>
            </div>
            <button onClick={() => setHideBalance(!hideBalance)} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-white/5">
              {hideBalance ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex items-end gap-4 mb-3">
            <h2 className="text-4xl font-black font-mono tabular-nums tracking-tight">
              {loading
                ? <span className="text-muted-foreground/40">Loading...</span>
                : hideBalance
                ? '••••••'
                : `$${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </h2>
            {!loading && !isNewUser && (
              <div className={`flex items-center gap-1.5 text-sm font-bold mb-1 px-2.5 py-1 rounded-xl ${isUp ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/15' : 'text-red-400 bg-red-500/10 border border-red-500/15'}`}>
                {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {isUp ? '+' : ''}{plPct}%
              </div>
            )}
          </div>
          {!loading && !isNewUser && (
            <p className={`text-sm font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {isUp ? '+' : ''}${Math.abs(pl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total P&L
            </p>
          )}
          {!loading && isNewUser && (
            <p className="text-sm text-muted-foreground">Make your first deposit to start trading</p>
          )}
        </div>
      </motion.div>

      {/* Quick Actions */}
      <div className="grid grid-cols-4 gap-3">
        {QUICK_ACTIONS.map(({ label, icon: Icon, path, gradient, border, iconColor }) => (
          <Link key={label} to={path}
            className={`flex flex-col items-center gap-2.5 p-4 rounded-2xl bg-gradient-to-br ${gradient} border ${border} hover:scale-[1.04] active:scale-[0.97] transition-all cursor-pointer group`}>
            <div className="w-10 h-10 rounded-xl bg-background/50 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Icon className={`w-4 h-4 ${iconColor}`} />
            </div>
            <span className="text-xs font-bold">{label}</span>
          </Link>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Area Chart */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="lg:col-span-2 bg-card border border-border rounded-3xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-sm font-bold">Portfolio Performance</p>
              {!loading && chartData.length >= 2 && (
                <p className={`text-xs mt-0.5 font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isUp ? '+' : ''}{plPct}% all time
                </p>
              )}
            </div>
            {!loading && chartData.length >= 2 && (
              <div className="flex items-center gap-1 bg-secondary/80 rounded-xl p-1">
                {PERIODS.map(({ label }, i) => (
                  <button key={label} onClick={() => setPeriod(i)}
                    className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-all ${i === period ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {loading ? (
            <div className="h-52 shimmer rounded-2xl" />
          ) : isNewUser || chartData.length < 2 ? (
            <div className="flex flex-col items-center justify-center h-52 gap-4">
              <div className="w-16 h-16 rounded-2xl border border-primary/20 flex items-center justify-center"
                style={{ background: 'radial-gradient(circle at 50% 50%, rgba(16,185,129,0.08), transparent)' }}>
                <BarChart2 className="w-8 h-8 text-primary/40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground/80 mb-1">No performance data yet</p>
                <p className="text-xs text-muted-foreground max-w-[200px]">Your portfolio chart will appear after your first deposit</p>
              </div>
              <Link to="/transactions" className="text-xs font-bold text-primary hover:underline px-4 py-2 rounded-xl bg-primary/10 border border-primary/20">
                Make a deposit →
              </Link>
            </div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="chartGradUp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="55%" stopColor="#10b981" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="chartGradDown" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                      <stop offset="55%" stopColor="#ef4444" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                    <filter id="chartGlow">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(215,14%,42%)', fontWeight: 500 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(215,14%,42%)', fontWeight: 500 }} axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: activeColor, strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.5 }} />
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={activeColor}
                    strokeWidth={2.5}
                    fill={isUp ? 'url(#chartGradUp)' : 'url(#chartGradDown)'}
                    dot={<CustomDot data={chartData} />}
                    activeDot={{ r: 5, fill: activeColor, stroke: 'rgba(0,0,0,0.4)', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </motion.div>

        {/* Donut Allocation Chart */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-card border border-border rounded-3xl p-5">
          <p className="text-sm font-bold mb-1">Allocation</p>
          {!loading && portfolioWithPrices.length > 0 && (
            <p className="text-xs text-muted-foreground mb-3 font-mono">${totalPortfolioValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} total</p>
          )}
          {loading ? (
            <div className="h-44 shimmer rounded-2xl" />
          ) : portfolioWithPrices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 gap-3">
              <Sparkles className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground text-center">No holdings yet.<br />Start trading to build your portfolio!</p>
              <Link to="/trade" className="text-xs font-bold text-primary hover:underline">Trade now →</Link>
            </div>
          ) : (
            <>
              <div className="h-40 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <defs>
                      {PIE_COLORS.map((color, i) => (
                        <radialGradient key={i} id={`pieGrad${i}`} cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor={color} stopOpacity={1} />
                          <stop offset="100%" stopColor={color} stopOpacity={0.75} />
                        </radialGradient>
                      ))}
                    </defs>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={66}
                      strokeWidth={2}
                      stroke="hsl(222,40%,10%)"
                      dataKey="value"
                      startAngle={90}
                      endAngle={-270}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={`url(#pieGrad${i % PIE_COLORS.length})`} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any) => [`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '']}
                      contentStyle={{
                        background: 'rgba(10,15,30,0.95)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '12px',
                        fontSize: '11px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                      }}
                      labelStyle={{ display: 'none' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground font-medium">Assets</p>
                    <p className="text-xl font-black">{portfolioWithPrices.length}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-2 mt-2">
                {portfolioWithPrices.slice(0, 4).map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-black/30" style={{ background: p.color }} />
                    <span className="text-xs text-muted-foreground flex-1 font-medium">{p.crypto_symbol}</span>
                    <span className="text-xs font-mono font-bold">
                      {totalPortfolioValue > 0 ? ((p.currentValue / totalPortfolioValue) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </motion.div>
      </div>

      {/* Market Snapshot */}
      {!loading && cryptos.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          className="bg-card border border-border rounded-3xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold">Market Snapshot</p>
            <Link to="/trade" className="text-xs text-primary hover:underline flex items-center gap-0.5 font-semibold">
              Trade <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {cryptos.slice(0, 5).map(c => (
              <div key={c.id}
                className="flex flex-col gap-1.5 px-3 py-3 rounded-2xl bg-secondary/70 hover:bg-secondary transition-all hover:scale-[1.02] cursor-default"
                style={{ border: '1px solid rgba(255,255,255,0.04)' }}>
                <div className="flex items-center gap-2">
                  <CoinIcon symbol={c.symbol} size={6} />
                  <span className="text-xs font-black">{c.symbol}</span>
                </div>
                <p className="text-sm font-mono font-bold tabular-nums">
                  ${c.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md w-fit ${c.change_24h >= 0 ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>
                  {c.change_24h >= 0 ? '+' : ''}{c.change_24h?.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Recent Transactions */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-card border border-border rounded-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold">Recent Transactions</p>
          <Link to="/transactions" className="text-xs text-primary hover:underline flex items-center gap-0.5 font-semibold">
            All <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
        {loading ? (
          [1, 2, 3].map(i => <div key={i} className="h-14 shimmer rounded-2xl mb-2" />)
        ) : txns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-muted-foreground/80">No transactions yet</p>
              <p className="text-xs text-muted-foreground mt-1">Deposit funds to get started</p>
            </div>
            <Link to="/transactions"
              className="text-xs font-bold text-primary hover:underline px-4 py-2 rounded-xl bg-primary/10 border border-primary/20">
              Make your first deposit
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            {txns.map((tx, idx) => {
              const isIn = ['deposit', 'sell', 'copy_profit'].includes(tx.type);
              return (
                <motion.div key={tx.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-secondary/60 transition-colors">
                  <div className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 ${isIn ? 'bg-emerald-500/10 border border-emerald-500/15' : 'bg-red-500/10 border border-red-500/15'}`}>
                    {isIn ? <ArrowDownLeft className="w-4 h-4 text-emerald-400" /> : <ArrowUpRight className="w-4 h-4 text-red-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold capitalize">{tx.type.replace('_', ' ')}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(tx.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-mono font-bold tabular-nums ${isIn ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isIn ? '+' : '-'}${Math.abs(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <span className={`text-[10px] font-bold capitalize px-1.5 py-0.5 rounded-md ${
                      tx.status === 'completed' || tx.status === 'approved' ? 'text-emerald-400 bg-emerald-500/10'
                      : tx.status === 'rejected' ? 'text-red-400 bg-red-500/10' : 'text-yellow-400 bg-yellow-500/10'
                    }`}>{tx.status}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}
