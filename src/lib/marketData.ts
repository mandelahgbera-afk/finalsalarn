const BASE = 'https://api.coingecko.com/api/v3';

export const COIN_ID_MAP: Record<string, string> = {
  BTC:   'bitcoin',
  ETH:   'ethereum',
  SOL:   'solana',
  BNB:   'binancecoin',
  XRP:   'ripple',
  ADA:   'cardano',
  DOGE:  'dogecoin',
  AVAX:  'avalanche-2',
  DOT:   'polkadot',
  MATIC: 'matic-network',
  LINK:  'chainlink',
  UNI:   'uniswap',
  ATOM:  'cosmos',
  LTC:   'litecoin',
  USDT:  'tether',
  USDC:  'usd-coin',
  SHIB:  'shiba-inu',
  TRX:   'tron',
  XLM:   'stellar',
  NEAR:  'near',
  APT:   'aptos',
  ARB:   'arbitrum',
  OP:    'optimism',
  INJ:   'injective-protocol',
  SUI:   'sui',
  FIL:   'filecoin',
  ICP:   'internet-computer',
  HBAR:  'hedera-hashgraph',
  VET:   'vechain',
  ALGO:  'algorand',
};

export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change_24h: number;
  market_cap: number;
  volume_24h: number;
  image: string;
}

const _marketsCache = new Map<string, { data: CoinMarket[]; ts: number }>();
const CACHE_TTL = 60_000; // 1 min

export async function fetchMarkets(symbols: string[]): Promise<CoinMarket[]> {
  const sorted = [...symbols].map(s => s.toUpperCase()).sort();
  const cacheKey = sorted.join(',');

  const cached = _marketsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const ids = [...new Set(
    sorted.map(s => COIN_ID_MAP[s]).filter(Boolean)
  )].join(',');

  if (!ids) return [];

  const url = `${BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  const data = await res.json();

  const result: CoinMarket[] = data.map((c: any) => ({
    id: c.id,
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    price: c.current_price ?? 0,
    change_24h: c.price_change_percentage_24h ?? 0,
    market_cap: c.market_cap ?? 0,
    volume_24h: c.total_volume ?? 0,
    image: c.image ?? '',
  }));

  _marketsCache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

export async function fetchTopMarkets(limit = 50): Promise<CoinMarket[]> {
  const url = `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  const data = await res.json();
  return data.map((c: any) => ({
    id: c.id,
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    price: c.current_price ?? 0,
    change_24h: c.price_change_percentage_24h ?? 0,
    market_cap: c.market_cap ?? 0,
    volume_24h: c.total_volume ?? 0,
    image: c.image ?? '',
  }));
}

export interface ChartPoint {
  t: string;
  v: number;
  ts: number;
}

const _chartCache = new Map<string, { data: ChartPoint[]; ts: number }>();
const CHART_TTL = 5 * 60_000; // 5 min

export async function fetchChart(symbol: string, days: number | string = 1): Promise<ChartPoint[]> {
  const coinId = COIN_ID_MAP[symbol.toUpperCase()];
  if (!coinId) return [];

  const key = `${coinId}:${days}`;
  const cached = _chartCache.get(key);
  if (cached && Date.now() - cached.ts < CHART_TTL) return cached.data;

  const daysNum = Number(days);
  const interval = daysNum === 1 ? 'hourly' : daysNum <= 7 ? 'hourly' : 'daily';
  const url = `${BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko chart error: ${res.status}`);
  const json = await res.json();
  const prices: [number, number][] = json.prices ?? [];

  const result: ChartPoint[] = prices.map(([ts, v]) => {
    const d = new Date(ts);
    const label = days === 1
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { ts, t: label, v: Math.round(v * 100) / 100 };
  });

  _chartCache.set(key, { data: result, ts: Date.now() });
  return result;
}
